/* eslint-env node */

// There are a lot of different ways that people can install python, and there is no
// universal name that they use for the actual executable. We can already assume
// that there is a working Node.js environment, so this script can figure it out.

var child_process = require('child_process');
var _which = require('which');

function which(command) {
  return _which.sync(command, {
    nothrow: true
  });
}

function run(command, args) {
  console.log('universal-python: Running ' + command + ' with arguments ' + args.join(', '));
  var subprocess = child_process.spawn(command, args, {
    windowsHide: true,
    shell: false,
    stdio: 'inherit'
  });
  subprocess.on('exit', function(code) {
    // Microsoft Store install shim exits with code 9009
    if (process.platform === 'win32' && code === 9009) {
      // eslint-disable-next-line max-len
      console.log('universal-python: Attempted to start python, but got the Microsoft Store installation shim. Install python from the Microsoft Store or python.org. (code 9009)');
    } else if (code === 0) {
      console.log('universal-python: Success');
    } else {
      console.log('universal-python: Failed with code ' + code);
    }
    process.exit(code);
  });
  subprocess.on('error', function(error) {
    console.log('universal-python: Error starting python; please ensure you have python installed: ' + error);
    process.exit(1);
  });
  process.on('SIGINT', function() {
    subprocess.kill('SIGINT');
  });
}

var argv = process.argv.slice(2);

if (process.platform === 'win32') {
  // Python in Windows is weird. Most commonly it will be installed using the python.org installers or
  // from the Microsoft Store. Interestingly the Microsoft Store shims always exist on PATH and are
  // also weird fake files so Node.js' fs does not work very well with them.
  // Python.org installers will usually install the py launcher, so we'll try that first so that we
  // don't open up the Microsoft Store for people who installed Python from there.
  var py = which('py.exe');
  if (py) {
    run(py, ['-3'].concat(argv));
  } else {
    // This will either run the python installation from PATH or the Microsoft Store install shim.
    // Don't know what version we'll get, but 2 and 3 both work so it doesn't matter.
    run('python.exe', argv);
  }
} else {
  // Python 3 is usually installed as python3
  var python3 = which('python3');
  if (python3) {
    run(python3, argv);
  } else {
    // Sometimes it might only be installed as python
    // Don't know what version we'll get, but 2 and 3 both work so it doesn't matter
    var python = which('python');
    if (python) {
      run(python, argv);
    } else {
      // Some old systems might only have python 2
      var python2 = which('python2');
      if (python2) {
        run(python2, argv);
      } else {
        console.log("universal-python: Could not find python on your PATH; please ensure you have python installed.");
        process.exit(1);
      }
    }
  }
}
