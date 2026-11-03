// esbuild inject: a minimal `process` for VM and renderer modules that read it in the browser bundle.
export const process = {
    browser: true,
    env: {NODE_ENV: 'production'},
    nextTick: callback => Promise.resolve().then(callback)
};
