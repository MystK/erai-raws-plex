const { argv } = require('yargs');

const sort = require('./sort');

if (argv.s || argv.sort) {
  sort(argv.f || argv.filename);
}
