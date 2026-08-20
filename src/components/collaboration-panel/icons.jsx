import PropTypes from 'prop-types';
import React from 'react';

const Icon = ({children, title}) => (
    <svg
        aria-hidden={title ? null : 'true'}
        fill="none"
        height="20"
        role={title ? 'img' : null}
        viewBox="0 0 24 24"
        width="20"
    >
        {title ? <title>{title}</title> : null}
        <g
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
        >{children}</g>
    </svg>
);

Icon.propTypes = {
    children: PropTypes.node.isRequired,
    title: PropTypes.string
};

const ChatIcon = props => (
    <Icon {...props}>
        <path d="M5 18.3 3.7 21l3.8-1.2c1.3.7 2.8 1 4.5 1 5 0 9-3.7 9-8.4S17 4 12 4s-9 3.7-9 8.4c0 2.3.8 4.3 2 5.9Z" />
        <path d="M7.5 10h9M7.5 14h6" />
    </Icon>
);
const NoteIcon = props => (
    <Icon {...props}>
        <path d="M6 3.5h12a2 2 0 0 1 2 2v10L15.5 20H6a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
        <path d="M15 20v-3.5a1 1 0 0 1 1-1h4M8 8h8M8 12h5" />
    </Icon>
);
const PeopleIcon = props => (
    <Icon {...props}>
        <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20v-2.1c0-2.6 2.7-4.7 6-4.7s6 2.1 6 4.7V20" />
        <path d="M15.3 4.6a3.3 3.3 0 0 1 0 6.1M16.2 13.5c3.1.4 5.3 2.3 5.3 4.6V20" />
    </Icon>
);
const HistoryIcon = props => (
    <Icon {...props}>
        <path d="M4.2 8.2A8.5 8.5 0 1 1 3.5 14" />
        <path d="M3 4v5h5M12 7.5V12l3 2" />
    </Icon>
);
const CloseIcon = props => <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
const LinkIcon = props => (
    <Icon {...props}>
        <path d="m9.5 14.5 5-5M7.2 16.8l-1.1 1.1a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2a3.4 3.4 0 0 1 4.8 0" />
        <path d="m16.8 7.2 1.1-1.1a3.4 3.4 0 0 1 4.8 4.8l-3.2 3.2a3.4 3.4 0 0 1-4.8 0" />
    </Icon>
);
const ClockIcon = props => (
    <Icon {...props}>
        <circle
            cx="12"
            cy="12"
            r="8.5"
        />
        <path d="M12 7.5V12l3 2" />
    </Icon>
);
const PinIcon = props => (
    <Icon {...props}>
        <path d="m8 3 8 2-1.6 4.1 3.1 3.1-4 4-3.1-3.1L6.3 15 4 7.2 8 3Z" />
        <path d="m10.5 13.5-6 6" />
    </Icon>
);
const UndoIcon = props => (
    <Icon {...props}>
        <path d="M8.5 8.5H4v-4" />
        <path d="M4.4 8.1A8.3 8.3 0 1 1 4 15" />
    </Icon>
);
const CopyIcon = props => (
    <Icon {...props}>
        <rect
            height="12"
            rx="2"
            width="12"
            x="8"
            y="8"
        />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
);

export {
    ChatIcon,
    ClockIcon,
    CloseIcon,
    CopyIcon,
    HistoryIcon,
    LinkIcon,
    NoteIcon,
    PeopleIcon,
    PinIcon,
    UndoIcon
};
