export const LOGIN_URL = '/login';
export const REGISTER_URL = '/register';

function navigateTo(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToLogin() {
  navigateTo(LOGIN_URL);
}

export function navigateToRegister() {
  navigateTo(REGISTER_URL);
}
