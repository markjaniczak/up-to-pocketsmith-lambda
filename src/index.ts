import { APIGatewayEvent } from 'aws-lambda';
import Axios from 'axios';
import { createHmac } from 'crypto';

interface UpObject<Attributes extends any> {
  type: string;
  id: string;
  attributes: Attributes;
  relationships: {
    [key: string]: {
      data: {
        type: string;
        id: string;
      };
      links: {
        related: string;
      };
    };
  };
}

interface UpWebhookEvent {
  eventType: 'TRANSACTION_CREATED' | 'TRANSACTION_SETTLED' | 'TRANSACTION_DELETED' | 'PING';
  /**
   * ISO8601 datetime String
   */
  createdAt: string;
}

interface UpMoneyObject {
  /**
   * ISO4217 Currency Code
   */
  currencyCode: string;
  /**
   * String representation of two decimal precision float
   */
  value: string;
  valueInBaseUnits: number;
}

interface UpRoundUp {
  amount: UpMoneyObject;
  boostPortion: Nullable<UpMoneyObject>;
}

interface UpTransaction {
  status: 'HELD' | 'SETTLED';
  rawText: Nullable<string>;
  description: string;
  message: Nullable<string>;
  amount: UpMoneyObject;
  roundUp: Nullable<UpRoundUp>;
  /**
   * ISO8601 datetime String
   */
  settledAt: Nullable<string>;
  /**
   * ISO8601 datetime String
   */
  createdAt: string;
}

const { UP_SECRET_KEY, UP_BEARER_TOKEN, POCKETSMITH_API_KEY, ACCOUNT_MAPPINGS } = process.env;

const addTransaction = async (transaction: UpObject<UpTransaction>) => {
  const accountMappings = JSON.parse(ACCOUNT_MAPPINGS);

  const pocketsmithAccount = accountMappings[transaction.relationships.account.data.id];

  const { attributes } = transaction;

  await Axios.post(
    `https://api.pocketsmith.com/v2/transaction_accounts/${pocketsmithAccount}/transactions`,
    {
      payee: attributes.description || attributes.rawText,
      amount: attributes.amount.valueInBaseUnits / 100,
      date: attributes.createdAt,
      memo: attributes.message,
      note: transaction.id,
    },
    {
      headers: {
        'X-Developer-Key': POCKETSMITH_API_KEY,
      },
    }
  );

  if (attributes.roundUp) {
    await Axios.post(
      `https://api.pocketsmith.com/v2/transaction_accounts/${pocketsmithAccount}/transactions`,
      {
        payee: 'Round Up',
        amount: attributes.roundUp.amount.valueInBaseUnits / 100,
        date: attributes.createdAt,
        note: transaction.id,
      },
      {
        headers: {
          'X-Developer-Key': POCKETSMITH_API_KEY,
        },
      }
    );
  }
};

const removeTransaction = async (transaction: UpObject<UpTransaction>) => {
  const accountMappings = JSON.parse(ACCOUNT_MAPPINGS);

  const pocketsmithAccount = accountMappings[transaction.relationships.account.data.id];

  const transactions = await Axios.get(`https://api.pocketsmith.com/v2/accounts/${pocketsmithAccount}/transactions`, {
    params: {
      search: transaction.id,
    },
    headers: {
      'X-Developer-Key': POCKETSMITH_API_KEY,
    },
  });

  if (transactions.data.length) {
    await Promise.all(
      transactions.data.map(({ id }: { id: string }) =>
        Axios.delete(`https://api.pocketsmith.com/v2/transactions/${id}`, {
          headers: {
            'X-Developer-Key': POCKETSMITH_API_KEY,
          },
        })
      )
    );
  }
};

export const handle = async (event: APIGatewayEvent): Promise<any> => {
  if (!event.body) {
    return {
      statusCode: 400,
    };
  }

  const isAuthentic =
    createHmac('sha256', UP_SECRET_KEY).update(event.body).digest('hex') ===
    event.headers['X-Up-Authenticity-Signature'];

  if (!isAuthentic) {
    return {
      statusCode: 401,
      body: 'Could not verify webhook',
    };
  }

  const json: { data: UpObject<UpWebhookEvent> } = JSON.parse(event.body);

  const eventType = json.data.attributes.eventType;

  if (!['TRANSACTION_DELETED', 'TRANSACTION_CREATED'].includes(eventType)) {
    return {
      statusCode: 200,
      body: '⛔',
    };
  }

  let transaction;
  try {
    transaction = await Axios.get<{ data: UpObject<UpTransaction> }>(
      `https://api.up.com.au/api/v1/transactions/${json.data.relationships.transaction.data.id}/`,
      {
        headers: {
          Authorization: `Bearer ${UP_BEARER_TOKEN}`,
        },
      }
    );

    if (eventType === 'TRANSACTION_CREATED') {
      await addTransaction(transaction.data.data);
    } else {
      await removeTransaction(transaction.data.data);
    }
  } catch (e) {
    return {
      statusCode: 500,
      body: e,
    };
  }

  return {
    statusCode: 200,
    body: '👌',
  };
};
