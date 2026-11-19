/// <reference types="vite/client" />

interface AcanthisRuntimeConfig {
	defaultApiBaseUrl?: string;
}

interface Window {
	__ACANTHIS_CONFIG__?: AcanthisRuntimeConfig;
}

interface ImportMetaEnv {
	readonly VITE_DEFAULT_API_BASE_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
