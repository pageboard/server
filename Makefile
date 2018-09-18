
destDir := node_modules/@pageboard

serverModules := $(wildcard ./modules-server/*)
serverLinks := $(patsubst ./modules-server/%,$(destDir)/%,$(serverModules))

clientModules := $(wildcard ./modules-client/*)
clientLinks := $(patsubst ./modules-client/%,$(destDir)/%,$(clientModules))

all: node_modules/@pageboard $(clientLinks) $(serverLinks)

node_modules/@pageboard:
	mkdir -p $@

$(destDir)/%: modules-server/%
	ln -s ../../$< $@

$(destDir)/%: modules-client/%
	ln -s ../../$< $@

