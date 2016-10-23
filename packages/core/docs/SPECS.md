pageboard
=========

routage
-------

Il y a trois grands types de routes

- les fichiers locaux (montés sur /media, /js, /css, ...)
- l'API (montée sur /api par exemple /api/blocks/46456) en JSON
- les blocs ayant une url canonique, et dont le rendu dépend du type mime.


sites
-----

Les différents sites sont gérés par une table de "sites":

```
domain: le nom de domaine du site, ou le préfixe du site
title: le titre du site
```

blocs
------

Le contenu du site est géré par une table en relation n,n avec elle-même,
la table de blocs, et en relation n,1 avec la table de sites.

```
// champs obligatoires
type: le type de composant
mime: le type mime que représente ce bloc
data: attributs json (noms => json)
content: contenus html (noms => html)

// champs optionels
lang: langue ISO 639-1
url: url canonique
template: a template name, e.g. a file name
```

> Comment déterminer si ces champs vont dans `data` ou pas ?
> Ce qui va dans `data` ne concerne que le client, pas le serveur.

> Qu'est qu'une URL canonique ?
> c'est une url qui rend la ressource accessible sans connaître son id,
> contrairement à /api/blocks/<id>

Il faut ajouter à cela:
- users
- permissions (en relation 1,n avec users)
- journals (en relation 1,1 avec users, enregistre les opérations sur l'api)
- sites (en relation 1,n avec les blocs, 1,n avec users)


composants
----------

Un composant est utilisé pour typer les blocs et les rendre éditables.

Ce qui est abordé ici est une relecture de la
[documentation de coed](https://github.com/kapouer/coed/blob/master/README.md).

Un composant a un nom qui sert à typer les blocs, et définit un schéma de bloc:
- des noms de données et leur schéma json
- des noms de contenus et leur schéma prosemirror

Un composant doit implémenter des fonctions pour parser et produire du DOM:
- saisi par l'utilisateur (input)
- utilisé lors de l'édition (from/to)
- exporté lors de la publication (output)

Données et contenus s'articulent ainsi par rapport au DOM parsés ou produits:
- le composant est entièrement responsable de parser et écrire les données
dans les différentes versions du DOM.
- les données ne sont éditables qu'à l'aide d'une interface utilisateur intégrée
par le composant dans le DOM éditable. Elles ne sont pas éditables en html.
- les contenus html éditables sont repérés par le composant en plaçant dans le
DOM d'édition un attribut `block-content`.

Exemple: un titre d'article n'est pas une donnée, c'est un contenu avec un
schéma qui n'autorise que du html inline.
Un statut d'article (important, épinglé) ou une date sont des données, et le
composant qui les gère peut proposer un menu select ou un calendrier pour les
modifier.


pages
-----

Une page est un bloc identifié par:
- un type "page"
- un mime type "text/html"
- une url canonique (et non pas /api/xxx)
- un template

> Pourquoi ne pas conserver les templates entiers dans la base de données ?
> La première raison est de laisser les templates facilement éditables par les
> développeurs.
> Une seconde raison est de simplifier les scripts de déploiement.
> À cause de cela, il n'est pas possible de bundler les dépendances de composants
> de manière dynamique.


enregistrement des contenus et références de blocs
--------------------------------------------------

La sérialisation des contenus est obtenue par la fonction de l'éditeur:
`get(function fn(component, dom, data, content) {})`

Dans `pageboard` la fonction passée en paramètre s'occupe de remplacer le dom
de chaque bloc par une *référence* de bloc:
`<div block-url="/api/blocks/123"></div>`
et de conserver la relation d'inclusion de ce bloc dans le bloc parent.

Ensuite il suffit d'enregistrer les blocs et leurs relations.

> Comment le positionnement des sous-blocs est conservé ?
> Les sous-blocs étant représentés par des références de blocs, ils sont
> simplement situés par leur position dans le contenu html du bloc parent.

> Tous les blocs doivent-ils être remplacés par des références ?
> Non - un bloc peut être entièrement embarqué dans le contenu du bloc parent,
> et n'a alors pas d'existence dans la base de données.

> L'url peut-elle retourner une liste de blocs, ou des données externes ?
> Non - pour cela il faut un bloc de type "liste", ou un bloc spécialisé pour
> importer des données externes.

> Une url de référence de bloc peut-elle être canonique ?
> Oui - et c'est particulièrement utile dans le cas d'une référence de bloc
> statique, c'est à dire ne faisant pas partie de contenu éditable.


rendu d'un bloc
---------------

L'algorithme est le suivant, étant donné un block initial racine.

```
var block = root;
var subBlocks = {
	// map of url -> block
};
var doc, dom, ref, url;
while (block) {
	dom = coed.components[block.type].output(coed, block.data, block.content);
	if (ref) ref.replaceWith(dom);
	else doc = dom;
	ref = dom.querySelector('[block-url]');
	if (!ref) break;
	url = ref.getAttribute('block-url');
	block = subBlocks[url];
}
// now do something with doc
```

Il est important de noter que *toutes* les références sont résolues, pas
seulement les références qui font partie d'un contenu, mais aussi celles
qui font partie du dom (donc du template) renvoyé par un composant.


rendu d'une page
----------------

Les pages sont rendues à l'aide d'un script de démarrage indépendant.

- une requête vers l'API pour obtenir un bloc ayant la même url canonique
  cette requête récupère aussi les sous-blocs, récursivement.
- si aucun bloc n'est trouvé, redirige vers une page 404
- le template correspondant à ce bloc est chargé, et le bloc et son template
sont utilisés par le composant `page` pour faire le rendu du bloc


référence de bloc et url canonique
----------------------------------

Lorsqu'un bloc de type page est créé, son template peut avoir besoin de blocs
qui ne sont pas particulièrement éditables par l'utilisateur et qui sont placés
par le développeur.

Dans ce cas il convient d'utiliser une url canonique pour ce genre de bloc,
et une référence permet alors d'en faire facilement faire le rendu.

```
<div block-url="/path/page/myblockname"></div>
```

> En effet on ne peut pas utiliser l'url d'api du bloc quand on veut l'insérer
> dans la page, et c'est plus simple d'éviter d'avoir à générer les url et le
> html avant de commencer le rendu de blocs.


validation de bloc par composant
--------------------------------

Les schémas précisés dans un composant sont utilisés par le serveur pour valider
les blocs avant de les enregistrer dans la base de données.

- validation des données  
  À l'aide d'un validateur json-schéma comme `ajv`.
  On pourra essayer d'améliorer le niveau de validation dans l'éditeur de texte,
  qui pour l'instant ne fait que vérifier l'absence ou la présence d'attributs.

- validation des contenus  
  Il faut un TreeAdapter pour `parse5` qui n'expose que DOM Level 1 Core, ou plus
  simplement `jsdom`, passer le document obtenu au parseur de prosemirror configuré
  avec le même schéma que celui du contenu, et resérialiser pour vérifier que
  les contenus correspondent.
  Une solution sans jsdom est possible, en utilisant la représentation json du DOM,
  mais demande de soumettre le bloc avec cette représentation, ce qui n'est pas
  toujours plus simple.


web components
--------------

Un bloc est forcément une instance de composant, mais sa version de publication
peut aussi être une instance de web component.

Il faut bien garder en tête que les deux notions sont séparées, un web component
ne se met à exister qu'après le rendu d'un bloc.


rendu de données externes
-------------------------

Il peut être parfois utile de pouvoir considérer une API qui n'a pas le même
format que l'API des blocs, ou encore de faire des recherches ou de la pagination
de blocs.

La bonne manière de faire cela dans `pageboard` est simplement de définir un
composant spécialisé qui va récupérer des données (distantes ou pas) et les
insérer en tant que blocs dans le contenu du bloc correspondant.

Le rendu de données externes ne peut cependant pas bénéficier dans le cas général
du préchargement des sous-blocs effectué lors de la récupération du bloc page.


liste dynamique de blocs
------------------------

Une liste de blocs est traitée un peu cmme un rendu de données externes:
un composant de type 'liste' est responsable de faire le rendu à partir d'une
liste de blocs obtenus
- par relation d'inclusion
- par une requête externe

Ce composant de type liste peut également accepter des paramètres pour gérer
la pagination, l'ordre, etc.


spécialisation
--------------

Il peut arriver qu'on veuille utiliser `pageboard` dans un cadre plus précis
que le cadre général d'un CMS.

Dans le liveactu on a ces particularités:

- les composants représentent des ressources ou des articles
- les pages doivent pouvoir être exportées en json
- les articles doivent être insérés par une référence de liste
- le contenu des articles (aside, content, title) doit pouvoir être exporté en json
- les ressources utilisées dans les articles sont affichées en front à l'aide
d'une sorte de custom element (simplifié) qui implémente du chargement différé.

Toutes ces particularités entrent dans le cadre de pageboard car ce sont de
simples restrictions.

