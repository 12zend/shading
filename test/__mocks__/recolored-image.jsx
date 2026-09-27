// The real component is an <img> connected to the Redux store only so it re-renders when the theme changes.
const React = require('react');

const RecoloredImage = ({src, ...props}) => React.createElement('img', Object.assign({
    src: typeof src === 'function' ? src() : src
}, props));

module.exports = {
    __esModule: true,
    default: RecoloredImage
};
