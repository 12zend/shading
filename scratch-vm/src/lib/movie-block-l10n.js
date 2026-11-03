const resolveLocale = (locale, vm) => {
    if (locale) return locale;
    if (vm && typeof vm.getLocale === 'function') return vm.getLocale();
    return 'en';
};

// `hiragana` is optional: blocks that provide it are shown in it for ja-Hira; the others keep English there.
const localize = (locale, english, japanese, hiragana) => {
    if (locale === 'ja') return japanese;
    if (locale === 'ja-Hira' && typeof hiragana !== 'undefined') return hiragana;
    return english;
};

export {
    localize,
    resolveLocale
};
