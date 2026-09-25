import PropTypes from 'prop-types';
import React from 'react';

// Content of an editor tab added by a plugin: either a React component rendered inside the editor (so it can use
// the editor's asset panels and state) or a plain DOM mount function. Like the built-in tabs, it only exists while
// visible.
class PluginTabPanel extends React.Component {
    static getDerivedStateFromError (error) {
        return {error};
    }
    constructor (props) {
        super(props);
        this.container = null;
        this.cleanup = null;
        this.setContainer = element => {
            this.container = element;
        };
        this.state = {error: null};
    }
    componentDidMount () {
        this.mount();
    }
    componentDidCatch (error) {
        console.error(`[plugins] Tab ${this.props.tab.key} failed:`, error); // eslint-disable-line no-console
    }
    componentWillUnmount () {
        this.unmount();
    }
    mount () {
        const {tab, vm, locale} = this.props;
        if (!tab.mount || !this.container) return;
        try {
            const cleanup = tab.mount(this.container, {vm, locale});
            this.cleanup = typeof cleanup === 'function' ? cleanup : null;
        } catch (error) {
            console.error(`[plugins] Tab ${tab.key} failed to mount:`, error); // eslint-disable-line no-console
            this.setState({error});
        }
    }
    unmount () {
        if (!this.cleanup) return;
        try {
            this.cleanup();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`[plugins] Tab ${this.props.tab.key} failed to clean up:`, error);
        }
        this.cleanup = null;
    }
    render () {
        const {tab, vm, locale} = this.props;
        if (this.state.error) {
            return <div style={{padding: '1rem'}}>{String(this.state.error.message || this.state.error)}</div>;
        }
        if (tab.component) {
            const Component = tab.component;
            return (
                <Component
                    locale={locale}
                    vm={vm}
                />
            );
        }
        return (
            <div
                ref={this.setContainer}
                style={{display: 'flex', flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto'}}
            />
        );
    }
}

PluginTabPanel.propTypes = {
    locale: PropTypes.string.isRequired,
    tab: PropTypes.shape({
        component: PropTypes.func,
        key: PropTypes.string.isRequired,
        mount: PropTypes.func
    }).isRequired,
    vm: PropTypes.object.isRequired // eslint-disable-line react/forbid-prop-types
};

export default PluginTabPanel;
