pageboard
=========

routage
-------

Il y a trois grands types de routes

- les fichiers locaux (montés sur /media, /js, /css, ...)
- l'API (montée sur /api)
- les pages (montées sur / avec un template générique configuré par API,
sur d'autres routes spécialisées)


base de données
---------------

Le contenu du site est géré par une seule table en relation n,n avec elle-même,
la table de "blocs":

```
type: le type sémantique (obligatoire)
mime: le type réel (obligatoire)
url: l'url publique du bloc
lang: langue ISO 639-1
data: attributs json (noms => html)
content: contenus html (noms => json)
```

D'autres colonnes, tables, et relations plus spécialisées peuvent être ajoutées;
par exemple l'administration du site a besoin d'une gestion des utilisateurs,
et des permissions.


composants
----------

Un composant est utilisé pour typer les blocs et les rendre éditables.

Ce qui est abordé ici est un résumé de la documentation du module `coed`.

Un composant a un nom qui sert à typer les blocs, et définit un schéma de bloc:
- des noms de données et leur schéma json
- des noms de contenus et leur schéma prosemirror

Les contenus sont des morceaux de HTML produits par l'éditeur dans un schéma
défini par composant et par nom de contenu.

Les données sont fusionnées entièrement ou en partie dans le template qui
enveloppe ces contenus. Certaines données servent à l'édition seulement,
d'autres sont essentielles pour produire un rendu html du bloc.

Exemple: un titre d'article n'est pas une donnée, c'est un contenu.
Un statut d'article (important, épinglé) ou une date sont des données.
On distingue données et contenus dans la mesure où le langage de schéma pour
les décrire n'est pas le même (json-schema pour les données, schemaSpec de
prosemirror pour les contenus).

Un composant a aussi des fonctions permettant de parser ou serialiser du DOM.
Ce DOM peut être dans trois formats: de saisie, d'édition et de publication.

- from(domNode) -> {data: ..., content: ...}
- to({data: ..., content: ...}) -> domNode  
Fonctions pour lire et écrire le format d'édition.
L'état du bloc (data et content) doit être entièrement contenu dans le format
d'édition DOM (to(from(node)) == node).
Le module d'édition `coed` demande d'ajouter des attributs spécifiques sur les
DOM nodes qui portent le contenu éditable (coed-name="nomducontenu").

- input(domNode) -> {data: ..., content: ...}  
La conversion depuis le format de saisie est optionnelle (par défaut `from`),
et permet de convertir une saisie utilisateur en données et contenus qui seront
ensuite rendus au format édition (to(input(node)))

- output({data: ..., content: ...}) -> domNode  
La conversion vers le format de publication est optionnelle (par défaut, `to`) et
produit un template pour la publication.

Il faut remarquer que le format de publication d'un composant peut varier en
fonction des données - voir plus bas pour les pages.


enregistrement des contenus et références de blocs
--------------------------------------------------

La sérialisation des contenus est obtenue par la fonction toDOM() de l'éditeur,
sachant que les blocs imbriqués sont automatiquement (pas par l'éditeur mais
par `pageboard`) remplacés par un Node du genre
`<div data-bloc="/api/blocs/123"></div>`

Ce Node est appelé une *référence* de bloc.

- il porte un attribut qui donne une référence du bloc remplacé
- ce node doit avoir un 'layout' pour pouvoir faire du lazy loading
- un bloc peut ne pas être référencé mais entièrement "embarqué" dans le contenu,
à condition que son composant soit capable de le relire à partir du html publié.
Ce bloc embarqué n'a alors pas d'existence dans la base de données.

Les références de blocs décrites ici portent sur un seul bloc à la fois.

Voir plus bas l'algorithme de rendu d'un bloc, qui explique comment on peut
aussi faire le rendu d'une liste de blocs, ou même d'une liste de données
externes convertibles en blocs.


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


rendu des blocs
---------------

1) une référence de bloc permet de récupérer auprès de l'API type, data, content
2) appeler components[type].output(data, content)
3) node.querySelectorAll([data-block]).forEach(refaire étape 1) et remplacer
le div par le html ainsi produit

La "récupération" du premier bloc doit aussi récupérer l'arbre des relations avec
ses sous-blocs, ce qui rend la récursion provoquée par 3) peu coûteuse en requêtes
additionnelles.


rendu de données externes
-------------------------

Il peut être parfois utile de pouvoir considérer une API qui n'a pas le même
format que l'API des blocs.

`<div data-bloc="http://external.com/path?params" data-bloc-type="mytypename">`

charge des données json externes. L'attribut `data-bloc-type` sert à forcer le
type de composant, dans les cas où les format externe n'est pas utilisable comme
un format de bloc (c'est à dire ne contient pas `data`, `content`, `type` avec
type une valeur de composant connu.


rendu de listes
---------------

Si la référence de bloc renvoie une liste, alors tous les éléments récupérés
sont simplement ajoutés en utilisant les modes de rendus définis avant.

Par exemple, il est possible de placer une liste paginée de blocs si l'API
de blocs supporte des paramètres de pagination, ou une liste de données
obtenues d'une source externe.


pages
-----

Une page est un bloc identifié par un type "page" et un mime type "text/html".
Il faut que l'url du bloc identifié comme étant une page soit accessible par
routage, mais c'est au CMS de faire attention à cela.

Par exemple, si l'url est un chemin /webcomponents/mapage.html et que le contenu
du dossier `webcomponents` est servi comme des fichiers statiques, ce bloc ne
sera pas prérendu mais sera visible comme une page dans le CMS. Dans ce cas le
CMS aurait plutôt dû donner un type "component" ou autre, mais pas "page".

Un bloc de type page possède une donnée "template" qui sert à définir quel
template html sert de document de base pour remplir la page.
L'avantage de cette approche est la simplicité de définition des templates de
pages, qui sont susceptibles de définir les ressources à compiler.

Dans cette version de `pageboard`, la compilation de dépendances dynamiques
n'est pas gérée, ni l'enregistrement de templates de pages dans la base de données.


spécialisation
--------------

Il peut arriver qu'on veuille utiliser `pageboard` dans un cadre plus précis
que le cadre général d'un CMS.

Dans le liveactu on a ces particularités:

- les composants représentent des ressources ou des articles
- les pages doivent pouvoir être exportées en json
- les articles doivent être insérés par une référence de liste
- le contenu des articles (aside, content, title) doit pouvoir être exporté en json
- les ressources utilisées dans les articles implémentent une forme de custom elements
avec du lazy loading

Toutes ces particularités entrent dans le cadre de pageboard car ce sont de
simples restrictions.

