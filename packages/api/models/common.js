var objection = require('objection');
var ref = objection.ref;
var Model = objection.Model;
var QueryBuilder = objection.QueryBuilder;

var UpdateOperation = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/UpdateOperation'
	)
);

var InstanceUpdateOperation = require(
	require('path').join(
		require.resolve('objection'),
		'..',
		'queryBuilder/operations/InstanceUpdateOperation'
	)
);

exports.Model = class CommonModel extends Model {
	$query(trx) {
		return super.$query(trx).patchObjectOperationFactory(() => {
			return new InstancePatchObjectOperation('patch', {
				instance: this,
				modelOptions: { patch: true }
			});
		});
	}
};

exports.QueryBuilder = class CommonQueryBuilder extends QueryBuilder {
	constructor(modelClass) {
		super(modelClass);
		this._patchObjectOperationFactory = function patchObjectOperationFactory() {
			return new UpdateOperation('patch', {
				modelOptions: { patch: true }
			});
		};
	}
	patchObjectOperationFactory(factory) {
		this._patchObjectOperationFactory = factory;
		return this;
	}
	whereJsonText(a) {
		var args = Array.from(arguments).slice(1);
		args.unshift(ref(a).castText());
		return this.where.apply(this, args);
	}
	patchObject(obj) {
		var patchObjectOperation = this._patchObjectOperationFactory();
		obj = Object.assign({}, obj);
		var type = patchObjectOperation.instance && patchObjectOperation.instance.type;
		if (type) {
			if (obj.type) {
				if (obj.type != type) throw new Error("Cannot patch object with different type");
			} else {
				obj.type = type;
			}
		} else if (!obj.type) {
			throw new Error("Cannot patch object without type");
		}
		this.skipUndefined();
		this.addOperation(patchObjectOperation, [obj]);
		return this;
	}
	whereObject(obj) {
		var table = this.tableRefFor(this.modelClass());
		var refs = asPaths(obj, {}, table + '.', true);
		for (var k in refs) {
			this.where(ref(k).castText(), Array.isArray(refs[k]) ? 'IN' : '=', refs[k]);
		}
		return this;
	}
	clone() {
		var builder = super.clone();
		builder._patchObjectOperationFactory = this._patchObjectOperationFactory;
		return builder;
	}
};

function asPaths(obj, ret, pre, first) {
	Object.keys(obj).forEach(function(key) {
		var val = obj[key];
		var cur = `${pre || ""}${key}`;
		if (Array.isArray(val) || val == null || typeof val != "object") {
			ret[cur] = val;
		} else if (typeof val == "object") {
			asPaths(val, ret, cur + (first ? ':' : '.'));
		}
	});
	return ret;
}


class PatchObjectOperation extends UpdateOperation {
	onBuildKnex(knexBuilder, builder) {
		const json = this.model.$toDatabaseJson(builder.knex());
		const jsonPaths = asPaths(json, {}, "", true);
		const convertedJson = this.convertFieldExpressionsToRaw(builder, jsonPaths);

		knexBuilder.update(convertedJson);
	}
}

class InstancePatchObjectOperation extends InstanceUpdateOperation {}

InstancePatchObjectOperation.prototype.onBuildKnex = PatchObjectOperation.prototype.onBuildKnex;

