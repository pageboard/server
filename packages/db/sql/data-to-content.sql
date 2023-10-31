with pages as (select block._id, block.data['title'] as title, block.data['description'] as description from block, relation, block site where site.id='myse' and relation.parent_id=site._id and block._id=relation.child_id and (block.type='page' or block.type='mail' or block.type='pdf')) update block set content['title']=title, content['description']=description FROM pages where block._id=pages._id;

with pages as (select block._id from block, relation, block site where site.id='myse' and relation.parent_id=site._id and block._id=relation.child_id and (block.type='page' or block.type='mail' or block.type='pdf')) update block set data = data - 'title' - 'description' FROM pages where block._id=pages._id;



