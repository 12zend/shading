// jsdom test environments (files marked @jest-environment jsdom) lack these Node globals, which enzyme's
// dependencies need as soon as they load.
const {TextDecoder, TextEncoder} = require('util');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
