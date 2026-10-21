/**
 * Copyright (C) 2021 Thomas Weber
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import './import-first';

import React from 'react';

import Interface from './render-interface.jsx';
import render from './app-target';

// The TurboWarp extension build runs from a blob: URL, which has no paths to route.
render(<Interface routingStyle={process.env.SHADING_EXTENSION ? 'static' : 'path'} />);
