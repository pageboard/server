#!/bin/sh
echo "Enabling long stack traces"
curdir=$(dirname $(dirname $(readlink -f $0)))
node --stack_trace_limit=100 \
	-r $curdir/node_modules/trace \
	$curdir/bin/cli.js

