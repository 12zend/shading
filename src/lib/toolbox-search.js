import {localize} from './movie-block-l10n';

// The button at the top of each category that opens its search box.
const CATEGORY_SEARCH_CALLBACK = 'SHADING_CATEGORY_SEARCH';

const normalizeSearchText = text => String(text || '').normalize('NFKC')
    .toLowerCase();

/**
 * Whether a block's text contains every word of a query, ignoring case and full-width forms.
 * @param {string} text Text of the block.
 * @param {string} query Words separated by spaces.
 * @returns {boolean} Whether the block matches.
 */
const matchesSearchQuery = (text, query) => {
    const target = normalizeSearchText(text);
    return normalizeSearchText(query).split(/\s+/)
        .filter(Boolean)
        .every(word => target.includes(word));
};

/**
 * Add a search box to the top of every category and narrow each category with a query to its matching blocks.
 * Categories that ScratchBlocks fills itself (variables, my blocks) are left unchanged.
 * @param {string} toolboxXML Toolbox XML.
 * @param {object} options Search state.
 * @param {object.<string, string>} options.queries Query by category ID.
 * @param {function(Element): string} options.getBlockText Text that a query is matched against.
 * @param {string} options.locale UI locale.
 * @returns {string} The toolbox XML with search boxes.
 */
const applyCategorySearch = (toolboxXML, {queries = {}, getBlockText, locale = 'en'}) => {
    if (typeof toolboxXML !== 'string' || typeof DOMParser === 'undefined') return toolboxXML;
    const document = new DOMParser().parseFromString(toolboxXML, 'text/xml');
    const root = document.documentElement;
    if (!root || document.getElementsByTagName('parsererror').length) return toolboxXML;
    const createElement = name => document.createElementNS(root.namespaceURI, name);
    for (const category of Array.from(root.children)) {
        const id = category.getAttribute('id');
        if (category.tagName.toLowerCase() !== 'category' || !id || category.hasAttribute('custom')) continue;
        const query = String(queries[id] || '').trim();
        if (query) {
            let matches = 0;
            for (const child of Array.from(category.children)) {
                if (child.tagName.toLowerCase() === 'block' && matchesSearchQuery(getBlockText(child), query)) {
                    matches++;
                } else {
                    category.removeChild(child);
                }
            }
            if (!matches) {
                const label = createElement('label');
                label.setAttribute('text', localize(locale, 'No matching blocks', '一致するブロックはありません'));
                category.appendChild(label);
            }
        }
        const button = createElement('button');
        button.setAttribute('text', query ?
            `${localize(locale, 'Search', '検索')}: ${query}` :
            localize(locale, 'Search blocks…', 'ブロックを検索…'));
        button.setAttribute('web-class', 'shadingCategorySearchButton');
        button.setAttribute('callbackKey', CATEGORY_SEARCH_CALLBACK);
        button.setAttribute('callbackData', id);
        category.insertBefore(button, category.firstChild);
    }
    return new XMLSerializer().serializeToString(document);
};

/**
 * The text input that edits a category's query in place of its search button.
 */
class CategorySearchInput {
    /**
     * @param {object} options Callbacks.
     * @param {function(string, string)} options.onChange Called with the category ID and query while typing.
     * @param {function(string): ?Element} options.getAnchor The search button element of a category.
     * @param {string} options.locale UI locale.
     */
    constructor ({onChange, getAnchor, locale}) {
        this.onChange = onChange;
        this.getAnchor = getAnchor;
        this.locale = locale;
        this.categoryId = null;
        this.input = null;
        this.handleInput = this.handleInput.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.close = this.close.bind(this);
    }

    open (categoryId, query) {
        if (!this.input) {
            this.input = document.createElement('input');
            this.input.type = 'search';
            this.input.className = 'shading-category-search';
            this.input.spellcheck = false;
            this.input.addEventListener('input', this.handleInput);
            this.input.addEventListener('keydown', this.handleKeyDown);
            this.input.addEventListener('blur', this.close);
        }
        this.categoryId = categoryId;
        this.input.placeholder = localize(this.locale, 'Search blocks', 'ブロックを検索');
        this.input.value = query || '';
        if (!this.input.parentNode) document.body.appendChild(this.input);
        if (!this.reposition()) {
            this.close();
            return;
        }
        this.input.focus();
        this.input.select();
    }

    isOpen () {
        return Boolean(this.input && this.input.parentNode);
    }

    // Keep the input over the search button after the toolbox is rebuilt.
    reposition () {
        if (!this.isOpen()) return false;
        const anchor = this.getAnchor(this.categoryId);
        if (!anchor) return false;
        const rect = anchor.rect;
        Object.assign(this.input.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${Math.max(rect.width, anchor.width)}px`,
            height: `${rect.height}px`
        });
        return true;
    }

    handleInput () {
        this.onChange(this.categoryId, this.input.value);
    }

    handleKeyDown (event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.input.value) this.onChange(this.categoryId, '');
            this.close();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            this.close();
        }
    }

    close () {
        if (this.input && this.input.parentNode) this.input.parentNode.removeChild(this.input);
    }

    dispose () {
        this.close();
        if (this.input) {
            this.input.removeEventListener('input', this.handleInput);
            this.input.removeEventListener('keydown', this.handleKeyDown);
            this.input.removeEventListener('blur', this.close);
        }
        this.input = null;
    }
}

export {
    CATEGORY_SEARCH_CALLBACK,
    CategorySearchInput,
    applyCategorySearch,
    matchesSearchQuery
};
