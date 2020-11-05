type Nullable<T> = T | null 

declare namespace NodeJS {
    interface ProcessEnv {
        UP_SECRET_KEY: string
        UP_BEARER_TOKEN: string
        POCKETSMITH_API_KEY: string
        ACCOUNT_MAPPINGS: string
    }
}