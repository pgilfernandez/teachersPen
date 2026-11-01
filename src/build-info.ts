declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const appVersion = __APP_VERSION__.replace(/\.0$/, '');
export const appCommit = __APP_COMMIT__;
