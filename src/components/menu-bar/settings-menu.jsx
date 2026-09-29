import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage} from 'react-intl';

import LanguageMenu from './language-menu.jsx';
import MenuBarMenu from './menu-bar-menu.jsx';
import {MenuItem, MenuSection} from '../menu/menu.jsx';
import MenuLabel from './tw-menu-label.jsx';
import TWAccentThemeMenu from './tw-theme-accent.jsx';
import TWGuiThemeMenu from './tw-theme-gui.jsx';
import TWBlocksThemeMenu from './tw-theme-blocks.jsx';
import TWDesktopSettings from './tw-desktop-settings.jsx';

import menuBarStyles from './menu-bar.css';

const SettingsMenu = ({
    canChangeLanguage,
    canChangeTheme,
    isRtl,
    onClickAddonSettings,
    onClickDesktopSettings,
    onClickSettingsModal,
    onOpenCustomSettings,
    onRequestClose,
    onRequestOpen,
    settingsMenuOpen
}) => (
    <MenuLabel
        open={settingsMenuOpen}
        onOpen={onRequestOpen}
        onClose={onRequestClose}
    >
        <span className={menuBarStyles.menuLabelText}>
            <FormattedMessage
                defaultMessage="Settings"
                description="Settings menu"
                id="gui.menuBar.settings"
            />
        </span>
        <MenuBarMenu
            className={menuBarStyles.menuBarMenu}
            open={settingsMenuOpen}
            place={isRtl ? 'left' : 'right'}
        >
            {(canChangeLanguage || canChangeTheme || onClickDesktopSettings) && (
                <MenuSection>
                    {canChangeLanguage && <LanguageMenu onRequestCloseSettings={onRequestClose} />}
                    {canChangeTheme && (
                        <React.Fragment>
                            <TWGuiThemeMenu />
                            <TWBlocksThemeMenu
                                onOpenCustomSettings={onOpenCustomSettings}
                            />
                            <TWAccentThemeMenu />
                        </React.Fragment>
                    )}
                    {onClickDesktopSettings && <TWDesktopSettings onClick={onClickDesktopSettings} />}
                </MenuSection>
            )}
            {(onClickAddonSettings || onClickSettingsModal) && (
                <MenuSection>
                    {onClickAddonSettings && (
                        <MenuItem
                            onClick={() => { // eslint-disable-line react/jsx-no-bind
                                onRequestClose();
                                onClickAddonSettings();
                            }}
                        >
                            <FormattedMessage
                                defaultMessage="Addons"
                                description="Button to open addon settings"
                                id="tw.menuBar.addons"
                            />
                        </MenuItem>
                    )}
                    {onClickSettingsModal && (
                        <MenuItem
                            onClick={() => { // eslint-disable-line react/jsx-no-bind
                                onRequestClose();
                                onClickSettingsModal();
                            }}
                        >
                            <FormattedMessage
                                defaultMessage="Advanced"
                                description="Button to open advanced settings menu"
                                id="tw.menuBar.advanced"
                            />
                        </MenuItem>
                    )}
                </MenuSection>
            )}
        </MenuBarMenu>
    </MenuLabel>
);

SettingsMenu.propTypes = {
    canChangeLanguage: PropTypes.bool,
    canChangeTheme: PropTypes.bool,
    isRtl: PropTypes.bool,
    onClickAddonSettings: PropTypes.func,
    onClickDesktopSettings: PropTypes.func,
    onClickSettingsModal: PropTypes.func,
    onOpenCustomSettings: PropTypes.func,
    onRequestClose: PropTypes.func,
    onRequestOpen: PropTypes.func,
    settingsMenuOpen: PropTypes.bool
};

export default SettingsMenu;
