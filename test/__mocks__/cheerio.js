// enzyme only uses cheerio's load(). cheerio's package entry also loads undici (its fetch client), which needs
// stream and messaging globals that jsdom test environments do not have.
const {load} = require('../../node_modules/cheerio/dist/commonjs/load-parse.js');

const cheerio = html => load('')(html);
cheerio.load = load;

module.exports = {
    __esModule: true,
    default: cheerio,
    load
};
