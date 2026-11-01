declare module 'dialog-polyfill' {
  const polyfill: { registerDialog(dialog: HTMLDialogElement): void };
  export default polyfill;
}
