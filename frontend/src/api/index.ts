import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRedirecting = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // Avoid reloading public auth pages. A transient authenticated request
      // during initial navigation must not create an endless /login loop.
      if (!isRedirecting && !['/login', '/setup'].includes(window.location.pathname)) {
        isRedirecting = true;
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  },
);

export { api };
