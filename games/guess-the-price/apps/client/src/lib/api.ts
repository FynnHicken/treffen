export const getApiUrl = (): string => {
	const envUrl = import.meta.env.VITE_API_URL;
	if (envUrl) {
		return envUrl;
	}
	if (typeof window !== 'undefined') {
		if (window.location.port === '8088') {
			return `http://${window.location.hostname}:3005/api`;
		}
		return '/price-guess-api';
	}
	return 'http://localhost:3005/api';
};

