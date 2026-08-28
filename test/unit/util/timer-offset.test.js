import compilerCompatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import installTimerOffset, {OPCODE} from '../../../src/lib/timer-offset';

const makeClock = () => ({
    _paused: false,
    _pausedTime: null,
    _projectTimer: {startTime: 0},
    runtime: {currentMSecs: 0},
    pause () {
        this._paused = true;
        this._pausedTime = this.runtime.currentMSecs - this._projectTimer.startTime;
    },
    resetProjectTimer () {
        this._projectTimer.startTime = this.runtime.currentMSecs;
        this._pausedTime = 0;
        this._paused = false;
    },
    projectTimer () {
        const elapsed = this._paused ? this._pausedTime : this.runtime.currentMSecs - this._projectTimer.startTime;
        return elapsed / 1000;
    }
});

const makeVM = () => {
    const runtime = {
        ioDevices: {},
        _primitives: {}
    };
    const clock = makeClock();
    clock.runtime = runtime;
    runtime.ioDevices.clock = clock;
    return {clock, runtime};
};

describe('Timer offset', () => {
    test('adds the configured offset to project timer reads and returns immediately', () => {
        const vm = makeVM();
        installTimerOffset(vm);
        const clock = vm.clock;
        const util = {
            ioQuery: (device, func, args) => vm.runtime.ioDevices[device][func](...args)
        };

        vm.runtime.currentMSecs = 10000;
        clock._projectTimer.startTime = 9000;
        expect(clock.projectTimer()).toBe(1);

        expect(vm.runtime._primitives[OPCODE]({OFFSET: 2.5}, util)).toBeUndefined();
        expect(clock.projectTimer()).toBe(3.5);
        expect(clock.projectTimerWithoutOffset()).toBe(1);
        expect(clock._projectTimer.startTime).toBe(9000);

        vm.runtime.currentMSecs = 12500;
        expect(clock.projectTimer()).toBe(6);
        expect(clock.projectTimerWithoutOffset()).toBe(3.5);

        vm.runtime._primitives[OPCODE]({OFFSET: 1}, util);
        expect(clock.projectTimer()).toBe(4.5);
    });

    test('updates the frozen value when the clock is paused', () => {
        const vm = makeVM();
        installTimerOffset(vm);
        const clock = vm.clock;
        const util = {
            ioQuery: (device, func, args) => vm.runtime.ioDevices[device][func](...args)
        };

        vm.runtime.currentMSecs = 10000;
        clock._projectTimer.startTime = 9000;
        clock.pause();
        vm.runtime._primitives[OPCODE]({OFFSET: 4}, util);

        expect(clock.projectTimer()).toBe(5);
        expect(clock.projectTimerWithoutOffset()).toBe(1);
        expect(compilerCompatBlocks.stacked).toContain(OPCODE);
    });

    test('allows negative offsets without changing the timeline clock', () => {
        const vm = makeVM();
        installTimerOffset(vm);
        const clock = vm.clock;
        const util = {
            ioQuery: (device, func, args) => vm.runtime.ioDevices[device][func](...args)
        };

        vm.runtime.currentMSecs = 10000;
        clock._projectTimer.startTime = 10000;
        vm.runtime._primitives[OPCODE]({OFFSET: -0.5}, util);

        expect(clock.projectTimer()).toBe(-0.5);
        expect(clock.projectTimerWithoutOffset()).toBe(0);
        expect(clock._projectTimer.startTime).toBe(10000);
    });

    test('clears the offset when the project timer is reset', () => {
        const vm = makeVM();
        installTimerOffset(vm);
        const clock = vm.clock;
        const util = {
            ioQuery: (device, func, args) => vm.runtime.ioDevices[device][func](...args)
        };

        vm.runtime.currentMSecs = 10000;
        clock._projectTimer.startTime = 9000;
        vm.runtime._primitives[OPCODE]({OFFSET: 2}, util);
        expect(clock.projectTimer()).toBe(3);

        clock.resetProjectTimer();
        expect(clock.projectTimer()).toBe(0);
    });
});
