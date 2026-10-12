# OctoPrint

Suivez et pilotez votre imprimante 3D depuis Gladys grâce à
[OctoPrint](https://octoprint.org), l'interface web libre des imprimantes 3D
(souvent installée sur un Raspberry Pi avec OctoPi). Tout reste sur votre
réseau local : Gladys parle directement à OctoPrint, sans compte cloud.

L'intégration a été testée contre un vrai OctoPrint (1.11.8) pilotant son
imprimante virtuelle intégrée : vraies impressions, pause, reprise,
annulation, fin d'impression. Elle n'a pas encore été essayée sur une
imprimante physique : vos retours sont les bienvenus sur le forum Gladys.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- OctoPrint 1.5 ou plus récent, joignable depuis la machine de Gladys. La page
  d'autorisation du bouton Connecter demande OctoPrint 1.10 ou plus récent ;
  avec une version plus ancienne, la demande s'affiche dans l'interface
  d'OctoPrint.
- Un utilisateur OctoPrint autorisé à piloter l'imprimante (celui qui accepte
  la demande : la clé a ses droits).
- Pour l'image de la webcam : OctoPrint 1.9 ou plus récent, avec une webcam
  capable de prendre des captures (le cas par défaut sur OctoPi).

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Dans **Adresse d'OctoPrint**, saisissez l'adresse avec laquelle vous ouvrez
   OctoPrint dans votre navigateur, par exemple `http://192.168.1.50`. Un port
   ou un chemin est accepté (`http://192.168.1.50:5000`,
   `https://example.org/octoprint`). Préférez une adresse IP : les noms
   `octopi.local` ne se résolvent pas dans le conteneur de l'intégration.
   Enregistrez.
3. Cliquez sur **Connecter à OctoPrint**. La page d'autorisation d'OctoPrint
   s'ouvre : connectez-vous si besoin, puis autorisez **Gladys Assistant**.
   L'intégration reçoit sa clé toute seule et l'enregistre dans **Clé d'API**
   (le champ reste masqué). L'état de l'écran de configuration passe à
   connecté.
4. Sans le bouton Connecter : créez une clé dans OctoPrint (**Paramètres →
   Application Keys**, ou la clé d'API de votre utilisateur), collez-la dans
   **Clé d'API**, puis enregistrez.
5. Une deuxième ou troisième imprimante : remplissez **Imprimante 2** et
   **Imprimante 3** de la même façon (une instance OctoPrint chacune).
6. **Langue** choisit la langue des noms de fonctionnalités et des textes
   créés par l'intégration (français par défaut). Les noms des fonctionnalités
   sont fixés à l'ajout de l'appareil dans Gladys.

Ajoutez ensuite l'imprimante depuis l'onglet **Découverte**.

## L'appareil imprimante

Un appareil par instance OctoPrint, nommé d'après le nom de l'instance
OctoPrint (**Paramètres → Apparence**), ou « OctoPrint ». Les valeurs arrivent
en temps réel par la connexion push d'OctoPrint (toutes les 5 secondes, les
événements immédiatement).

| Fonctionnalité         | Ce qu'elle affiche                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| État                   | Opérationnelle, Impression, Mise en pause, En pause, Reprise, Annulation, Finalisation, Erreur, Imprimante déconnectée, OctoPrint injoignable, Clé d'API refusée |
| Fichier                | Le fichier en cours d'impression, ou le dernier                                                                                                                  |
| Progression            | Pourcentage de l'impression (100 % conservé après une impression terminée, 0 après une annulation)                                                               |
| Temps écoulé           | En minutes                                                                                                                                                       |
| Temps restant          | Estimé par OctoPrint, en minutes (0 au repos)                                                                                                                    |
| Buse, Plateau, Caisson | Températures, en degrés entiers ; une buse par extrudeur, le caisson seulement si le profil d'imprimante déclare un caisson chauffant                            |
| … (consigne)           | Consignes : modifiables depuis le tableau de bord (buse 0 à 350 °C, plateau 0 à 150 °C, caisson 0 à 100 °C)                                                      |
| Pause, Reprise         | Boutons poussoirs                                                                                                                                                |
| Webcam                 | L'image de la webcam, via OctoPrint (si une webcam avec capture est configurée)                                                                                  |

Il n'y a volontairement pas de bouton **annuler** sur l'appareil : un appui
sans confirmation ruinerait une impression. L'annulation est proposée par le
widget (avec confirmation) et par les scènes.

Ce que possède l'imprimante (buses, plateau et caisson chauffants, webcam)
vient du profil d'imprimante actif dans OctoPrint. Quand il change, Gladys
propose de mettre à jour l'appareil dans l'onglet **Découverte**.

## Widget de tableau de bord

Ajoutez le widget **Impression 3D** à un tableau de bord et choisissez
l'imprimante dans ses réglages. Il affiche :

- la jauge de progression, le temps restant, les températures de la buse et
  du plateau (en direct) ;
- l'état, le fichier, le temps écoulé, l'heure de fin prévue, les consignes
  actives ;
- les boutons utiles au moment : **Pause** ou **Reprendre** et **Annuler**
  (demande confirmation) pendant une impression ; **Préchauffer** et, quand
  quelque chose chauffe, **Refroidir** au repos.

Les températures de préchauffage sont des réglages du widget (200 °C et 60 °C
par défaut, PLA).

## Déclencheurs de scène

Dans la catégorie **Intégrations** de l'éditeur de scènes. Chacun peut être
limité à une imprimante.

- **Impression démarrée** : variables nom de l'imprimante, fichier.
- **Impression terminée** : variables nom de l'imprimante, fichier, durée
  d'impression (en texte, comme `1 h 05 min`, et en minutes).
- **Impression échouée ou annulée** : peut être limité à une raison (annulée,
  erreur). Variables nom de l'imprimante, fichier, durée d'impression, raison.
- **Impression en pause** : par un utilisateur ou par l'imprimante elle-même
  (fin de filament). Variables nom de l'imprimante, fichier, temps écoulé.

Les variables se lisent dans les actions suivantes avec, par exemple,
`{{triggerEvent.data.file}}` et `{{triggerEvent.data.duration}}`.

## Actions de scène

- **Mettre en pause, reprendre ou annuler une impression** : renvoie
  **Appliqué** à faux quand il n'y avait rien à mettre en pause, reprendre ou
  annuler (la scène continue).
- **Préchauffer l'imprimante** : consignes de la buse (de toutes les buses) et
  du plateau, 200 °C et 60 °C par défaut. Refusé pendant une impression
  (Appliqué : faux) : une scène qui préchauffe à heure fixe ne touche jamais
  une impression en cours.
- **Couper les chauffes** : toutes les consignes à 0, aussi pendant une
  impression (qui échoue alors).

## Exemples de scènes

- **Impression terminée → notification** : déclencheur Impression terminée,
  action « Envoyer un message » :
  `{{triggerEvent.data.file}} terminé en {{triggerEvent.data.duration}}`.
- **Fumée détectée → tout arrêter** : déclencheur sur le détecteur de fumée,
  actions Mettre en pause, reprendre ou annuler une impression (annuler), puis
  Couper les chauffes, puis éteindre la prise connectée de l'imprimante.
- **Prête au lever** : à 7 h en semaine, Préchauffer l'imprimante (sans effet
  si une impression tourne).
- **Lumière pour la webcam** : Impression démarrée → allumer la lumière de
  l'atelier ; Impression terminée ou Impression échouée → l'éteindre.

## Dépannage

- **OctoPrint ne répond pas** : vérifiez l'adresse depuis la machine de Gladys
  (`curl http://192.168.1.50/api/version` répond 403 sans clé : OctoPrint est
  joignable). Utilisez une adresse IP plutôt que `octopi.local`.
- **Clé d'API absente ou refusée** : cliquez de nouveau sur Connecter, ou
  collez une nouvelle clé. Une clé révoquée dans OctoPrint (**Paramètres →
  Application Keys**) cesse aussitôt de fonctionner.
- **Connecter ne fait rien / « refusée ou expirée »** : la demande doit être
  acceptée dans les 10 minutes, par un utilisateur autorisé à donner l'accès.
  OctoPrint accepte au plus 3 demandes par minute : attendez une minute avant
  de réessayer. Si le plugin Application Keys est désactivé, collez une clé.
- **L'adresse redirige** (http vers https) : saisissez l'adresse finale.
- **Pas d'image de webcam** : l'image doit être un JPEG de 150 Ko au plus
  (limite de Gladys) : baissez la résolution de la webcam dans OctoPrint.
- **Les valeurs ont 10 s de retard** : la connexion push est indisponible (un
  proxy inverse sans WebSocket) : l'intégration lit alors l'API toutes les
  10 secondes, et déduit les événements d'impression des changements d'état.
- Logs : dans la page de l'intégration de Gladys, ou `docker logs` sur l'hôte.
  `LOG_LEVEL=debug` donne le détail. La clé d'API n'apparaît jamais dans les
  logs.

## Limites

- Trois instances OctoPrint au plus.
- Pas d'envoi de fichier, pas de lancement d'impression depuis Gladys, pas de
  commandes G-code, pas de timelapse.
- L'image de la webcam est une capture rafraîchie chaque minute (et à la
  demande), pas un flux vidéo.
- Quand l'intégration ne peut pas utiliser la connexion push, un événement de
  moins de 10 secondes peut être manqué, et une impression arrêtée par une
  erreur n'est signalée en échec (raison « erreur ») que si OctoPrint affiche
  l'état d'erreur.
- Développée sans imprimante physique (l'imprimante virtuelle d'OctoPrint a
  servi) : vos retours sont les bienvenus.
- Sans lien avec OctoPrint. OctoPrint est un projet de Gina Häußge.
