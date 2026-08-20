import React from 'react';

const GearIcon = () => (
    <svg
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
    >
        <path
            d={'M9.7 3.7 10.4 2h3.2l.7 1.7 1.7.7 1.7-.7 2.3 2.3-.7 1.7.7 1.7 1.7.7v3.2' +
                'l-1.7.7-.7 1.7.7 1.7-2.3 2.3-1.7-.7-1.7.7-.7 1.7h-3.2L9.7 20 8 19.3l-1.7.7' +
                'L4 17.7l.7-1.7L4 14.3l-1.7-.7v-3.2L4 9.7 4.7 8 4 6.3 6.3 4l1.7.7 1.7-.7Z'}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
        />
        <circle
            cx="12"
            cy="12"
            r="3"
            stroke="currentColor"
            strokeWidth="1.7"
        />
    </svg>
);

const PlayIcon = () => (
    <svg
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
    >
        <path
            d="m8.5 5.5 10 6.5-10 6.5v-13Z"
            fill="currentColor"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
        />
    </svg>
);

const PauseIcon = () => (
    <svg
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
    >
        <rect
            fill="currentColor"
            height="13"
            rx="1"
            width="3.5"
            x="6.5"
            y="5.5"
        />
        <rect
            fill="currentColor"
            height="13"
            rx="1"
            width="3.5"
            x="14"
            y="5.5"
        />
    </svg>
);

export {
    GearIcon,
    PauseIcon,
    PlayIcon
};
