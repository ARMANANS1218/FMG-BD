/* Simple logger wrapper to keep logs consistent */
const logPrefix = '[EmailTicketing]';

module.exports = {
  info: (...args) => console.log(logPrefix, ...args),
  warn: (...args) => console.warn(logPrefix, ...args),
  error: (...args) => console.error(logPrefix, ...args),
};
