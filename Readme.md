# ThreeNetwork

ThreeNetwork is real-time network library for Three.js. ThreeNetwork synchronizes Three.js objects with remote. It supports [PeerJS](http://peerjs.com/), [EasyRTC](https://easyrtc.com/), and [Firebase](https://firebase.google.com/)

## Demo

- [PeerJS](http://takahirox.github.io/ThreeNetworkDemo/peerjs.html)
- [PeerJS with Skinning edit](http://takahirox.github.io/ThreeNetworkDemo/peerjs_mmd.html)
- EasyRTC
- [Firebase](http://takahirox.github.io/ThreeNetworkDemo/firebase.html)
- [Firebase+WebRTC](http://takahirox.github.io/ThreeNetworkDemo/firebase2.html)

## Screen shot

# Features

T.B.D.

- easy to setup and use
- low latency with WebRTC

# Instruction

## Sample code

```javascript
  <script src="https://rawgit.com/mrdoob/three.js/r85/build/three.js"></script>

  <script src="js/networks/RemoteSync.js"></script>
  <script src="js/networks/FirebaseSignalingServer.js"></script>
  <script src="js/controls/WebRTCClient.js"></script>

  var remoteSync, localId;

  remoteSync = new THREE.RemoteSync(
    new THREE.WebRTCClient(
      new THREE.FirebaseSignalingServer( {
        authType: 'anonymous',
        apiKey: 'your-api',
        authDomain: 'your-project.firebaseapp.com',
        databaseURL: 'https://your-project.firebaseio.com'
      } )
    )
  );

  // when connects with signaling server
  remoteSync.addEventListener( 'open', function ( id ) {
    localId = id;
    var localMesh = new THREE.Mesh(...);
    remoteSync.addLocalObject( localMesh, { type: 'mesh' } );
    scene.add( localMesh );
  } );

  // when remote adds an object
  remoteSync.addEventListener( 'add', function ( remotePeerId, objectId, info ) {
    var remoteMesh;
    switch( info.type ) {
      case 'mesh':
        remoteMesh = new THREE.Mesh(...);
        break;
      default:
        return;
    }
    scene.add( remoteMesh );
    remoteSync.addRemoteObject( remotePeerId, objectId, remoteMesh );
  } );

  // when remote removes an object
  remoteSync.addEventListener( 'remove', function ( remotePeerId, objectId, object ) {
    if ( object.parent !== null ) object.parent.remove( object );
  } );
```

## Concept

T.B.D.

- local object
- remote object
- shared object

## Files

T.B.D.

RemoteSync
- js/networks/RemoteSync.js

NetworkClient & Signaling server
- js/networks/FirebaseSignalingServer.js
- js/networks/WebRTCClient.js
- js/networks/PeerJSClient.js
- js/networks/EasyRTCClient.js
- js/networks/FirebaseClient.js


## API

T.B.D.

RemoteSync
- addLocalObject
- addSharedObject
- addRemoteObject 
- sendUserData, broadcastUserData
- addEventListener
  - open
  - close
  - error
  - connect
  - disconnect
  - add
  - remove
  - receive
  - remote_stream
  - receive_user_data
