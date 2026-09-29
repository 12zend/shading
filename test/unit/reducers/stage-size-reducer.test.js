/* eslint-env jest */
import stageSizeReducer from '../../../src/reducers/stage-size';
import {STAGE_SIZE_MODES} from '../../../src/lib/layout-constants';

test('defaults to the fixed large (middle) stage size mode', () => {
    expect(stageSizeReducer(undefined, {type: 'anything'}).stageSize).toBe(STAGE_SIZE_MODES.large);
});
