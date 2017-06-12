/**
 * @author Takahiro https://github.com/takahirox
 *
 * TODO
 *   support interpolation
 *   support packet loss recover for UDP
 *   proper error handling
 *   optimize data transfer payload
 *   support material sync
 */

( function () {

	/**
	 * RemoteSync constructor.
	 * RemoteSync synchronizes registered Object3D matrix and
	 * morphTargetInfluences with remote users.
	 * @param {THREE.NetworkClient} client - NetworkClient handling data transfer
	 */
	THREE.RemoteSync = function ( client ) {

		this.client = client;
		this.id = '';

		// for local object

		this.localObjects = [];
		this.localObjectTable = {};  // object.uuid -> object
		this.localObjectInfos = {};  // object.uuid -> info

		// for remote object

		this.remoteObjectTable = {}; // remote peer id -> remote object.uuid -> object
		this.remoteObjectInfos = {}; // remote peer id -> remote object.uuid -> info

		// for shared object

		this.sharedObjects = [];
		this.sharedObjectTable = {};     // shared id -> object
		this.sharedObjectRecursives = {}; // shared id -> boolean (true or undefined)

		// for local and shared object

		this.transferComponents = {};  // object.uuid -> component

		// event listeners

		this.onOpens = [];
		this.onCloses = [];
		this.onErrors = [];
		this.onConnects = [];
		this.onDisconnects = [];
		this.onReceives = [];
		this.onAdds = [];
		this.onRemoves = [];
		this.onRemoteStreams = [];
		this.onReceiveUserDatas = [];
		this.onUpdates = {};  // object.uuid -> update callback function

		// experiment, master

		this.master = false;
		this.masterPeer = this.id;

		this.onMasters = [];
		this.onSlaves = [];
		this.onMasterNotifications = [];

		//

		this.initClientEventListener();

		// if client is already opened

		if ( this.client.id !== '' ) {

			var self = this;

			requestAnimationFrame(

				function () {

					self.id = self.client.id;
					self.invokeOpenListeners( self.id );
					self.beMaster();

				}

			);

		}

	};

	Object.assign( THREE.RemoteSync.prototype, {

		// public

		/**
		 * Adds EventListener. Callback function will be invoked when
		 * 'open': a connection is established with a signaling server
		 * 'close': a connection is disconnected from a signaling server
		 * 'error': network related error occurs
		 * 'connect': a connection is established with a remote peer
		 * 'disconnect': a connection is disconnected from a remote peer
		 * 'receive': receives remote data sent from a remote peer
		 * 'add': receives an remote object info registered by .addLocalObject()
		 * 'remove': receives an remote object removed by .removeLocalObject()
		 * 'update: shared or remote object is updated by remote's .sync()
		 * 'remote_stream': receives a remote media stream
		 * 'receive_user_data': receives user-data from remote sent by
		 *                      .sendUserData() or .broadUserData()
		 * 'master': being a master peer from a slave peer (experiment)
		 * 'slave': being a slave peer from a master (experiment)
		 * 'master_notification': being notified a master peer (experiment)
		 *
		 * Arguments for callback functions are
		 * 'open': {string} local peer id
		 * 'close': {string} local peer id
		 * 'error': {string} error message
		 * 'connect': {string} remote peer id
		 *            {boolean} if a remote peer sends connection request
		 * 'disconnect': {string} remote peer id
		 * 'receive': {object} component object sent from remote peer
		 * 'add': {string} remote peer id
		 *        {string} remote object uuid
		 *        {anything} user-specified data
		 * 'remove': {string} remote peer id
		 *           {string} remote object uuid
		 *           {string} removed object, registered as remote object
		 * 'remote_stream': {MediaStream} remote media stream
		 * 'receive_user_data': {anything} user-data sent from remote
		 * 'master_notification': {string} master peer id
		 *
		 * .addEventListener() requires three arguments for 'update',
		 * two arguments for others.
		 *
		 * TODO: implement .removeEventListener()
		 *
		 * @param {string} type - event type
		 * @param {THREE.Object3D} object - for 'update'
		 * @param {function} func - callback function
		 */
		addEventListener: function ( type, arg1, arg2 ) {

			var func, object;

			if ( type === 'update' ) {

				object = arg1;
				func = arg2;

			} else {

				func = arg1;

			}

			switch ( type ) {

				case 'open':
					this.onOpens.push( func );
					break;

				case 'close':
					this.onCloses.push( func );
					break;

				case 'error':
					this.onErrors.push( func )
					break;

				case 'connect':
					this.onConnects.push( func )
					break;

				case 'disconnect':
					this.onDisconnects.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'add':
					this.onAdds.push( func );
					break;

				case 'remove':
					this.onRemoves.push( func );
					break;

				case 'update':
					// TODO: check if object is registered as shared or remote object here?
					this.onUpdates[ object.uuid ] = func;  // overrides without any warning so far.
					                                       // even if listener is registered.
					break;

				case 'remote_stream':
					this.onRemoteStreams.push( func );
					break;

				case 'receive_user_data':
					this.onReceiveUserDatas.push( func );
					break;

				case 'master':
					this.onMasters.push( func );
					break;

				case 'slave':
					this.onSlaves.push( func );
					break;

				case 'master_notification':
					this.onMasterNotifications.push( func );
					break;

				default:
					console.log( 'THREE.RemoteSync.addEventListener: Unknown type ' + type );
					break;

			}

		},

		/**
		 * Joins the room or connects a remote peer, depending on NetworkClient instance.
		 * @param {string} id - destination peer id or room id. 
		 */
		connect: function ( id ) {

			this.client.connect( id );

		},

		/**
		 * Registers a local object. Local object's matrix and
		 * morphTargetInfluences will be sent to remote by invoking .sync().
		 * @param {THREE.Object3D} object
		 * @param {anything} info - user-specified info representing an object, passed to remote 'add' event listener
		 * @param {boolean} recursive - recursively registers children if true
		 */
		addLocalObject: function ( object, info, recursive ) {

			if ( this.localObjectTable[ object.uuid ] !== undefined ) {

				console.warn( 'THREE.RemoteSync.addLocalObject: This object has already been registered.' );
				return;

			}

			if ( info === undefined ) info = {};

			this.localObjectTable[ object.uuid ] = object;
			this.localObjects.push( object );
			this.localObjectInfos[ object.uuid ] = { userInfo: info	};

			this.transferComponents[ object.uuid ] = createTransferComponent( object );

			if ( recursive === true ) {

				var self = this;

				// TODO: move out this function not to make function for
				//       every .addLocalObject() call.
				// TODO: optimize. maybe can replace with recursive .addLocalObject() call?
				//
				// Same TODOs for .addRemoteObject(), .addSharedObject(), remoteLocalObject(),
				// .remoteRemoteObject(), and .remoteSharedObject().
				function traverse( parent ) {

					var array = [];

					for ( var i = 0, il = parent.children.length; i < il; i ++ ) {

						var child = parent.children[ i ];

						if ( self.localObjectTable[ child.uuid ] !== undefined ) continue;

						self.localObjectTable[ child.uuid ] = child;
						self.localObjects.push( child );
						// child: true indicates this object is registered as child of another object
						self.localObjectInfos[ child.uuid ] = { child: true };

						self.transferComponents[ child.uuid ] = createTransferComponent( child );

						var param = {};
						param.id = child.uuid;
						param.children = traverse( child );

						array[ i ] = param;

					}

					return array;

				}

				this.localObjectInfos[ object.uuid ].recursive = true;
				this.localObjectInfos[ object.uuid ].children = traverse( object );

			}

			if ( this.client.connectionNum() > 0 ) this.broadcastAddObjectRequest( object );

		},

		/**
		 * Removes a registered local object. If an object's children
		 * are recursively resistered, also removes them.
		 * @param {THREE.Object3D} object
		 */
		removeLocalObject: function ( object ) {

			if ( this.localObjectTable[ object.uuid ] === undefined ) {

				console.warn( 'THREE.RemoteSync.removeLocalObject: object not found' );
				return;

			}

			var info = this.localObjectInfos[ object.uuid ];

			delete this.localObjectTable[ object.uuid ];
			delete this.localObjectInfos[ object.uuid ];
			delete this.transferComponents[ object.uuid ];

			removeObjectFromArray( this.localObjects, object );

			if ( info.recursive === true ) {

				var self = this;

				// assumes object's tree structure doesn't change since
				// it's registered.
				function traverse( parent ) {

					for ( var i = 0, il = parent.children.length; i < il; i ++ ) {

						var child = parent.children[ i ];

						if ( self.localObjectTable[ child.uuid ] === undefined ) continue;

						delete self.localObjectTable[ child.uuid ];
						delete self.localObjectInfos[ child.uuid ];
						delete self.transferComponents[ child.uuid ];

						removeObjectFromArray( self.localObjects, child );

						traverse( child );

					}

				}

				traverse( object );

			}

			if ( this.client.connectionNum() > 0 ) this.broadcastRemoveObjectRequest( object );

		},

		/**
		 * Registers an object whose matrix and morphTargetInfluences will be updated by
		 * a remote object. Registered object will be automatically removed from RemoteSync
		 * if corresponging object is removed from RemoteSync in remote. If corresponding
		 * object's children is recursively registered, recursively registeres children here, too.
		 * @param {string} destId - remote peer id
		 * @param {string} objectId - remote object uuid
		 * @param {THREE.Object3D} object
		 */
		addRemoteObject: function ( destId, objectId, object ) {

			var objects = this.remoteObjectTable[ destId ];

			if ( objects === undefined ) {

				console.warn( 'THREE.RemoteSync.addRemoteObject: has not received any add object request from ' + destId + ' peer.' );
				return;

			}

			var infos = this.remoteObjectInfos[ destId ];
			var info = infos[ objectId ];

			if ( info === undefined ) {

				console.warn( 'THREE.RemoteSync.addRemoteObject: has not received ' + objectId + ' object addition request from ' + destId + ' peer.' );
				return;

			}

			if ( objects[ objectId ] !== undefined ) {

				console.warn( 'THREE.RemoteSync.addRemoteObject: object for ' + objectId + ' object of ' + destId + ' peer has been already registered.' );
				return;

			}

			objects[ objectId ] = object;

			// assumes corresponding remote's local object and this object has the same
			// tree structure including the order of children.
			if ( info.recursive === true ) {

				function traverse( obj, param ) {

					var children1 = obj.children;
					var children2 = param.children;

					for ( var i = 0, il = Math.min( children1.length, children2.length ); i < il; i ++ ) {

						var child1 = children1[ i ];
						var child2 = children2[ i ];

						if ( objects[ child2.id ] !== undefined ) continue;

						objects[ child2.id ] = child1;
						infos[ child2.id ] = { child: true };

						traverse( child1, child2 );

					}

				}

				traverse( object, info );

			}

		},

		/**
		 * Registers a shared object. Shared object's matrix and
		 * morphTargetInfluences will be sent from/to remote.
		 * Shared object is associated with user-defined shared id.
		 * It synchronizes with a remote object which has the same
		 * shared id.
		 * @param {THREE.Object3D} object
		 * @param {string} id - shared id.
		 * @param {boolean} recursive - recursively adds children if true
		 */
		addSharedObject: function ( object, id, recursive ) {

			if ( this.sharedObjectTable[ id ] !== undefined ) {

				console.warn( 'THREE.RemoteSystem.addSharedObject: Shared id ' + id + ' is already used.' );
				return;

			}

			this.sharedObjectTable[ id ] = object;
			this.sharedObjects.push( object );

			var component = createTransferComponent( object );
			component.sid = id;  // shared id, special property for shared object
			this.transferComponents[ object.uuid ] = component;

			if ( recursive === true ) {

				this.sharedObjectRecursives[ id ] = true;

				var self = this;

				function traverse( parentId, parent ) {

					var children = parent.children;

					for ( var i = 0, il = children.length; i < il; i ++ ) {

						var child = children[ i ];
						// can conflict with other user-specified id?
						var id = parentId + '__' + i;

						if ( self.sharedObjectTable[ id ] !== undefined ) continue;

						self.sharedObjectTable[ id ] = child;
						self.sharedObjects.push( child );

						var component = createTransferComponent( child );
						component.sid = id;
						self.transferComponents[ child.uuid ] = component;

						traverse( id, child );

					}

				}

				traverse( id, object );

			}

		},

		/**
		 * Removes a shared object. If object's children are recursively
		 * registered, also removes them.
		 * @param {string} id - shared id
		 */
		removeSharedObject: function ( id ) {

			if ( this.sharedObjectTable[ id ] === undefined ) {

				console.warn( 'THREE.RemoteSync.removeSharedObject: no found shared id ' + id );
				return;

			}

			var object = this.sharedObjectTable[ id ];

			delete this.sharedObjectTable[ id ];

			removeObjectFromArray( this.sharedObjects, object );

			if ( this.sharedObjectRecursives[ id ] === true ) {

				delete this.sharedObjectRecursives[ id ];

				var self = this;

				// assumes object tree structure doesn't change since
				// it's registered as shared object.
				function traverse( parentId, parent ) {

					var children = parent.children;

					for ( var i = 0, il = children.length; i < il; i ++ ) {

						var id = parentId + '__' + i;

						if ( self.sharedObjectTable[ id ] === undefined ) continue;

						var child = self.sharedObjectTable[ id ];

						delete self.sharedObjectTable[ id ];

						removeObjectFromArray( self.sharedObjects, child );

						traverse( id, child );

					}

				}

				traverse( id, object );

			}

		},

		/**
		 * Sends registered local and shared objects' matrix and morphTargetInfluence
		 * to remote. Only the properties which are updated since last .sync() invoking 
		 * will be sent.
		 * @param {boolean} force - force to send the properties even if they aren't updated
		 * @param {boolean} onlyLocal - send only local objects properties
		 */
		sync: function ( force, onlyLocal ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.did = null;
			component.type = TRANSFER_TYPE_SYNC;

			var list = component.list;
			list.length = 0;

			for ( var i = 0; i < 2; i ++ ) {

				// i === 0 local, i === 1 shared

				if ( i === 1 && onlyLocal === true ) continue;

				var array = i === 0 ? this.localObjects : this.sharedObjects;

				for ( var j = 0, jl = array.length; j < jl; j ++ ) {

					var object = array[ j ];

					if ( force === true || this.checkUpdate( object ) ) {

						list.push( this.serialize( object ) );

					}

				}

			}

			if ( list.length > 0 ) this.client.broadcast( component );

		},

		/**
		 * Sends user-data to a peer.
		 * @param {string} destId - a remote peer id
		 * @param {anything} data - user-data
		 */
		sendUserData: function ( destId, data ) {

			var component = buildUserDataComponent( this.id, data );
			component.did = destId;
			this.client.send( destId, component );

		},

		/**
		 * Broadcasts user-data.
		 * @param {anything} data - user-data
		 */
		broadcastUserData: function ( data ) {

			var component = buildUserDataComponent( this.id, data );
			component.did = null;
			this.client.broadcast( component );

		},

		// private

		/**
		 * Sets up event listeners for client.
		 */
		initClientEventListener: function () {

			var self = this;

			this.client.addEventListener( 'open',

				function ( id ) { 

					self.id = id;
					self.invokeOpenListeners( id );
					self.beMaster();

				}

			);

			this.client.addEventListener( 'close',

				function ( id ) {

					self.invokeCloseListeners( id );

				}

			);

			this.client.addEventListener( 'error',

				function ( error ) {

					self.invokeErrorListeners( error );

				}

			);

			this.client.addEventListener( 'connect',

				function ( id, fromRemote ) {

					self.invokeConnectListeners( id, fromRemote );

					if ( ! fromRemote && self.isMaster() ) self.beSlave();

					if ( self.isMaster() ) self.sendMasterPeerId( id );

					// send already registered local objects info
					// to newly connected remote
					self.sendAddObjectsRequest( id );
					self.sync( true, ! fromRemote );

				}

			);

			this.client.addEventListener( 'disconnect',

				function ( id ) {

					// removes objects registered as remote object
					// of disconnected peer

					var objects = self.remoteObjectTable[ id ];

					if ( objects === undefined ) return;

					var keys = Object.keys( objects );

					for ( var i = 0, il = keys.length; i < il; i ++ ) {

						self.removeRemoteObject( id, keys[ i ] );

					}

					delete self.remoteObjectTable[ id ];

					self.invokeDisconnectListeners( id );

					if ( self.masterPeer === id ) self.electNewMaster();

				}

			);

			// TODO: returns ack to ensure the data transfer?
			this.client.addEventListener( 'receive',

				function ( component ) {

					// if this data is not for me then ignore.
					if ( component.did !== undefined &&
						component.did !== null &&
						self.id !== component.did ) return;

					switch ( component.type ) {

						case TRANSFER_TYPE_SYNC:
							self.handleSyncRequest( component );
							break;

						case TRANSFER_TYPE_ADD:
							self.handleAddRequest( component );
							break;

						case TRANSFER_TYPE_REMOVE:
							self.handleRemoveRequest( component );
							break;

						case TRANSFER_TYPE_USER_DATA:
							self.invokeReceiveUserDataListeners( component );
							break;

						case TRANSFER_TYPE_MASTER_NOTIFY:
							self.handleMasterNotification( component );
							break;

						default:
							console.log( 'THREE.RemoteSync: Unknown type ' + component.type );
							break;

					}

					self.invokeReceiveListeners( component );

				}

			);

			this.client.addEventListener( 'remote_stream',

				function ( stream ) {

					self.invokeRemoteStreamListeners( stream );

				}

			);

		},

		/**
		 * Handles sync request sent from remote.
		 * @param {object} component - transfer component sent from remote
		 */
		handleSyncRequest: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var objectId = list[ i ].id;  // remote object uuid
				var sharedId = list[ i ].sid; // shared object id

				var object;

				if ( sharedId !== undefined ) {

					// shared object

					object = this.sharedObjectTable[ sharedId ];

				} else {

					if ( objects === undefined ) continue;

					object = objects[ objectId ];

				}

				if ( object === undefined ) continue;

				this.deserialize( object, list[ i ] );

				// to update transfer component
				if ( sharedId !== undefined ) this.serialize( object );

			}

		},

		/**
		 * Handles add request sent from remote.
		 * @param {object} component - transfer component sent from remote
		 */
		handleAddRequest: function ( component ) {

			var destId = component.id;
			var list = component.list;

			if ( this.remoteObjectTable[ destId ] === undefined ) {

				this.remoteObjectTable[ destId ] = {};
				this.remoteObjectInfos[ destId ] = {};

			}

			var objects = this.remoteObjectTable[ destId ];
			var infos = this.remoteObjectInfos[ destId ];

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var objectId = list[ i ].id;
				var info = list[ i ].info;

				if ( objects[ objectId ] !== undefined ) continue;

				infos[ objectId ] = info;

				this.invokeAddListeners( destId, objectId, info.userInfo );

			}

		},

		/**
		 * Handles remove request sent from remote.
		 * @param {object} component - transfer component sent from remote
		 */
		handleRemoveRequest: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			if ( objects === undefined ) return;

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var objectId = list[ i ].id;

				var object = objests[ objectId ];

				if ( object === undefined ) continue;

				this.removeRemoveObject( destId, objectId, object );

			}

		},

		/**
		 * Removes an object registered as a remote object.
		 * Invokes 'remove' event listener. If corresponding object's children
		 * in remote are recursively registers, also removes them.
		 * @param {string} destId - remote peer id
		 * @param {string} objectId - remote object uuid
		 */
		removeRemoteObject: function ( destId, objectId ) {

			if ( this.remoteObjectTable[ destId ] === undefined ) return;

			var objects = this.remoteObjectTable[ destId ];
			var infos = this.remoteObjectInfos[ destId ];

			if ( objects[ objectId ] === undefined ) return;

			var object = objects[ objectId ];
			var info = infos[ objectId ];

			delete objects[ objectId ];
			delete infos[ objectId ];

			if ( info.recursive === true ) {

				// assumes remote's local object and this object has the
				// same tree structure including the order of children.
				function traverse( obj, param ) {

					var children1 = obj.children;
					var children2 = param.children;

					for ( var i = 0, il = Math.min( children1.length, children2.length ); i < il; i ++ ) {

						var child1 = children1[ i ];
						var child2 = children2[ i ];

						delete objects[ child2.id ];
						traverse( child1, child2 );

					}

				}

				traverse( object, info );

			}

			this.invokeRemoteListeners( destId, objectId, object );

		},

		/**
		 * Checks if object properties are updated since the last .sync() invoking.
		 * Sees number as Float32 because 1. I want to ignore very minor change
		 * 2. it seems like number will be handled as Float32 on some platforms.
		 * @param {THREE.Object3D} object
		 * @returns {boolean}
		 */
		checkUpdate: function ( object ) {

			var component = this.transferComponents[ object.uuid ];

			var array = component.matrix;
			var array2 = object.matrix.elements;

			for ( var i = 0, il = array.length; i < il; i ++ ) {

				if ( ensureFloat32( array[ i ] ) !== ensureFloat32( array2[ i ] ) ) return true;

			}

			if ( object.morphTargetInfluences !== undefined ) {

				var array = component.morphTargetInfluences;
				var array2 = object.morphTargetInfluences;

				for ( var i = 0, il = array.length; i < il; i ++ ) {

					if ( ensureFloat32( array[ i ] ) !== ensureFloat32( array2[ i ] ) ) return true;

				}

			}

			return false;

		},

		/**
		 * Serializes object. Ensures number as Float32 because it seems like
		 * number is handled as Float32.
		 * @param {THREE.Object3D} object
		 * @returns {object} transfer component object made from object
		 */
		serialize: function ( object ) {

			var component = this.transferComponents[ object.uuid ];

			var array = component.matrix;
			var array2 = object.matrix.elements;

			for ( var i = 0, il = array.length; i < il; i ++ ) {

				array[ i ] = ensureFloat32( array2[ i ] );

			}

			if ( object.morphTargetInfluences !== undefined ) {

				var array = component.morphTargetInfluences;
				var array2 = object.morphTargetInfluences;

				for ( var i = 0, il = array.length; i < il; i ++ ) {

					array[ i ] = ensureFloat32( array2[ i ] );

				}

			}

			return component;

		},

		/**
		 * Desrializes transfer component.
		 * @param {THREE.Object3D} object - object will be updated with component
		 * @param {object} component
		 */
		deserialize: function ( object, component ) {

			var transferComponent = this.transferComponents[ object.uuid ];

			object.matrix.fromArray( component.matrix );
			object.matrix.decompose( object.position, object.quaternion, object.scale );

			if ( object.morphTargetInfluences !== undefined && component.morphTargetInfluences.length > 0 ) {

				var array = component.morphTargetInfluences;
				var array2 = object.morphTargetInfluences;

				for ( var i = 0, il = array.length; i < il; i ++ ) {

					array2[ i ] = array[ i ];

				}

			}

			if ( this.onUpdates[ object.uuid ] !== undefined ) {

				this.onUpdates[ object.uuid ]();

			}

		},

		/**
		 * Broadcasts object addition request.
		 * @param {THREE.Object3D} object
		 */
		broadcastAddObjectRequest: function ( object ) {

			this.client.broadcast( buildObjectAdditionComponent( this.id, object, this.localObjectInfos[ object.uuid ] ) );

		},

		/**
		 * Sends already registered local objects addition request.
		 * @param {string} destId - remote peer id
		 */
		sendAddObjectsRequest: function ( destId ) {

			var component = buildObjectsAdditionComponent( this.id, this.localObjects, this.localObjectInfos );
			component.did = destId;

			this.client.send( destId, component );

		},

		/**
		 * Broadcasts object removal request.
		 * TODO: enables multiple objects remove request?
		 * @param {THREE.Object3D} object
		 */
		broadcastRemoveObjectRequest: function ( object ) {

			this.client.broadcast( buildObjectRemovalComponent( this.id, object ) );

		},

		// invoke event listeners. refer to .addEventListener() comment for arguments.

		invokeOpenListeners: function ( id ) {

			for ( var i = 0, il = this.onOpens.length; i < il; i ++ ) {

				this.onOpens[ i ]( id );

			}

		},

		invokeCloseListeners: function ( id ) {

			for ( var i = 0, il = this.onCloses.length; i < il; i ++ ) {

				this.onCloses[ i ]( id );

			}

		},

		invokeErrorListeners: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		invokeConnectListeners: function ( id, fromRemote ) {

			for ( var i = 0, il = this.onConnects.length; i < il; i ++ ) {

				this.onConnects[ i ]( id, fromRemote );

			}

		},

		invokeDisconnectListeners: function ( id ) {

			for ( var i = 0, il = this.onDisconnects.length; i < il; i ++ ) {

				this.onDisconnects[ i ]( id );

			}

		},

		invokeAddListeners: function ( destId, objectId, info ) {

			for ( var i = 0, il = this.onAdds.length; i < il; i ++ ) {

				this.onAdds[ i ]( destId, objectId, info );

			}

		},

		invokeRemoteListeners: function ( destId, objectId, object ) {

			for ( var i = 0, il = this.onRemoves.length; i < il; i ++ ) {

				this.onRemoves[ i ]( destId, objectId, object );

			}

		},

		invokeReceiveListeners: function ( component ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( component );

			}

		},

		invokeRemoteStreamListeners: function ( stream ) {

			for ( var i = 0, il = this.onRemoteStreams.length; i < il; i ++ ) {

				this.onRemoteStreams[ i ]( stream );

			}

		},

		invokeReceiveUserDataListeners: function ( component ) {

			for ( var i = 0, il = this.onReceiveUserDatas.length; i < il; i ++ ) {

				this.onReceiveUserDatas[ i ]( component.list[ 0 ] );

			}

		},

		// experiment, master

		/**
		 * Note: RemoteSync automaticallly chooses one peer as a master peer in the room.
		 *       Application will be notified when local peer becomes a master/non-master(slave)
		 *       via 'master'/'slave' event listener.
		 *       Application can uses this master functionality if it wants only one peer
		 *       in the room to do something.
		 *       This feature is very experiment now. The current logic isn't robust.
		 */

		// private

		/**
		 * Returns the flag indicating if I'm a master peer.
		 * @return {boolean}
		 */
		isMaster: function () {

			return this.master;

		},

		/**
		 * Lets myself be a master peer.
		 */
		beMaster: function () {

			if ( ! this.isMaster() ) {

				this.master = true;
				this.masterPeer = this.id;
				this.notifyBeingMaster();
				this.invokeMasterListeners();

			}

		},

		/**
		 * Lets myself be a slave peer.
		 */
		beSlave: function () {

			if ( this.isMaster() ) {

				this.master = false;
				this.invokeSlaveListeners();

			}

		},

		/**
		 * Notifies that I become a master peer to other peers.
		 */
		notifyBeingMaster: function () {

			var component = buildMasterNotificationComponent( this.id, this.masterPeer );
			component.did = null;
			this.client.broadcast( component );

		},

		/**
		 * Sends a master peer's id to a remote peer.
		 * @params {string} destId - remote peer id
		 */
		sendMasterPeerId: function ( destId ) {

			var component = buildMasterNotificationComponent( this.id, this.masterPeer );
			component.did = destId;
			this.client.send( destId, component );

		},

		/**
		 * Handles master notification sent from a remote peer.
		 * @params {object} component - data sent from a remote peer
		 */
		handleMasterNotification: function ( component ) {

			var newMasterPeer = component.list[ 0 ];

			if ( newMasterPeer === this.id && ! this.isMaster() ) {

				this.beMaster();

			} else if ( newMasterPeer !== this.id && this.isMaster() ) {

				this.beSlave();

			}

			if ( newMasterPeer !== this.masterPeer ) {

				this.masterPeer = newMasterPeer;

				this.invokeMasterNotificationListeners( newMasterPeer );

			}

		},

		/**
		 * Elects a new master peer.
		 * Assumes this's called when a master peer leaves the room.
		 */
		electNewMaster: function () {

			// TODO: I don't wanna touch connections out of NetworkClient.
			var connections = this.client.connections;

			// Chooses the first peer ordered by peer id as a master peer so far.
			// This logic is very temporal.

			var array = [ this.id ];

			for ( var i = 0, il = connections.length; i < il; i ++ ) {

				array.push( connections[ i ].peer );

			}

			if ( array.sort()[ 0 ] === this.id ) {

				this.beMaster();

			}

		},

		invokeMasterListeners: function () {

			for ( var i = 0, il = this.onMasters.length; i < il; i ++ ) {

				this.onMasters[ i ]();

			}

		},

		invokeSlaveListeners: function () {

			for ( var i = 0, il = this.onSlaves.length; i < il; i ++ ) {

				this.onSlaves[ i ]();

			}

		},

		invokeMasterNotificationListeners: function ( masterPeer ) {

			for ( var i = 0, il = this.onMasterNotifications.length; i < il; i ++ ) {

				this.onMasterNotifications[ i ]( masterPeer );

			}

		}

	} );

	// transfer component

	var TRANSFER_TYPE_SYNC = 0;
	var TRANSFER_TYPE_ADD = 1;
	var TRANSFER_TYPE_REMOVE = 2;
	var TRANSFER_TYPE_USER_DATA = 3;
	var TRANSFER_TYPE_MASTER_NOTIFY = 4;

	var TRANSFER_COMPONENT = {
		id: null,   // source id
		did: null,  // destination id, null for broadcast
		type: -1,
		list: []
	};

	var float32Value = new Float32Array( 1 );

	function ensureFloat32( value ) {

		float32Value[ 0 ] = value;
		return float32Value[ 0 ];

	}

	function removeObjectFromArray( array, object ) {

		// TODO: optimize

		var readIndex = 0;
		var writeIndex = 0;

		for ( var i = 0, il = array.length; i < il; i ++ ) {

			if ( array[ i ] === object ) {

				array[ writeIndex ] = array[ readIndex ];
				writeIndex ++;

			}

			readIndex ++;

		}

		array.length = writeIndex;

	}

	/**
	 * Creates a new transfer component for an local or shared object.
	 * @param {THREE.Object3D} object
	 * @returns {object} transfer component
	 */
	function createTransferComponent( object ) {

		var matrix = [];
		var morphTargetInfluences = [];

		for ( var i = 0, il = object.matrix.elements.length; i < il; i ++ ) {

			matrix[ i ] = ensureFloat32( object.matrix.elements[ i ] );

		}

		if ( object.morphTargetInfluences !== undefined ) {

			for ( var i = 0, il = object.morphTargetInfluences.length; i < il; i ++ ) {

				morphTargetInfluences[ i ] = ensureFloat32( object.morphTargetInfluences[ i ] );

			}

		}

		return {
			id: object.uuid,
			matrix: matrix,
			morphTargetInfluences: morphTargetInfluences
		};

	}

	/**
	 * Builds transfer component for add objects request.
	 * TODO: move into RemoteSync?
	 * @param {string} sourceId - local peer id
	 * @param {Array} objects - Array of THREE.Object3D
	 * @param {object} infoTable
	 * @returns {object} transfer component
	 */
	function buildObjectsAdditionComponent( sourceId, objects, infoTable ) {

		var component = TRANSFER_COMPONENT;
		component.id = sourceId;
		component.did = null;
		component.type = TRANSFER_TYPE_ADD;

		var list = component.list;
		list.length = 0;

		for ( var i = 0, il = objects.length; i < il; i ++ ) {

			var object = objects[ i ];
			var info = infoTable[ object.uuid ];

			// not sends this object because it'll be included in
			// parent addition request.
			if ( info.child === true ) continue;

			list.push( { id: object.uuid, info: info } );

		}

		return component;

	}

	/**
	 * Builds transfer component for add an object request.
	 * @param {string} sourceId - local peer id
	 * @param {THREE.Object3D} object
	 * @param {object} infoTable
	 * @returns {object} transfer component
	 */
	function buildObjectAdditionComponent( sourceId, object, info ) {

		var component = TRANSFER_COMPONENT;
		component.id = sourceId;
		component.did = null;
		component.type = TRANSFER_TYPE_ADD;

		var list = component.list;
		list.length = 0;

		list.push( { id: object.uuid, info: info } );

		return component;

	}

	/**
	 * Builds transfer component for remove object request.
	 * @param {string} sourceId - local peer id
	 * @param {THREE.Object3D} object
	 * @returns {object} transfer component
	 */
	function buildObjectRemovalComponent( sourceId, object ) {

		var component = TRANSFER_COMPONENT;
		component.id = sourceId;
		component.did = null;
		component.type = TRANSFER_TYPE_REMOVE;

		var list = component.list;
		list.length = 0;

		list.push( { id: object.uuid } );

		return component;

	}

	/**
	 * Builds transfer component for user-data transfer request.
	 * @param {string} sourceId - local peer id
	 * @param {anything} data
	 * @returns {object} transfer component
	 */
	function buildUserDataComponent( sourceId, data ) {

		var component = TRANSFER_COMPONENT;
		component.id = sourceId;
		component.type = TRANSFER_TYPE_USER_DATA;

		var list = component.list;
		list.length = 0;
		list.push( data );

		return component;

	}

	/**
	 * Builds transfer component for master peer notification.
	 * @param {string} sourceId - local peer id
	 * @param {string} masterPeer - master peer's id
	 * @returns {object} transfer component
	 */
	function buildMasterNotificationComponent( sourceId, masterPeer ) {

		var component = TRANSFER_COMPONENT;
		component.id = sourceId;
		component.type = TRANSFER_TYPE_MASTER_NOTIFY;

		var list = component.list;
		list.length = 0;
		list.push( masterPeer );

		return component;

	}

} )();

( function () {

	/**
	 * NetworkClient constructor.
	 * NetworkClient handles network connection and data transfer.
	 * NetworkClient is an abstract class.
	 * Set local media streaming to params.stream if you wanna send it to remote.
	 * Concrete class is assumed WebRTC/Firebase/WebSocket based client.
	 * @param {object} params - instanciate parameters (optional)
	 */
	THREE.NetworkClient = function ( params ) {

		if ( params === undefined ) params = {};

		this.id = params.id !== undefined ? params.id : '';
		this.stream = params.stream !== undefined ? params.stream : null;

		this.roomId = '';

		// connections
		// connection is a object which has a remote peer id in .peer property.
		// a connection per a connected remote peer.

		this.connections = [];
		this.connectionTable = {};  // remote peer id -> connection

		// event listeners

		this.onOpens = [];
		this.onCloses = [];
		this.onErrors = [];
		this.onConnects = [];
		this.onDisconnects = [];
		this.onReceives = [];
		this.onRemoteStreams = [];

		if ( params.onOpen !== undefined ) this.addEventListener( 'open', params.onOpen );
		if ( params.onClose !== undefined ) this.addEventListener( 'close', params.onClose );
		if ( params.onError !== undefined ) this.addEventListener( 'error', params.onError );
		if ( params.onConnect !== undefined ) this.addEventListener( 'connect', params.onConnect );
		if ( params.onDisconnect !== undefined ) this.addEventListener( 'disconnect', params.onDisconnect );
		if ( params.onReceive !== undefined ) this.addEventListener( 'receive', params.onReceive );
		if ( params.onRemoteStream !== undefined ) this.addEventListener( 'remote_stream', params.onRemoteStream );

	};

	Object.assign( THREE.NetworkClient.prototype, {

		// public

		/**
		 * Adds EventListener. Callback function will be invoked when
		 * 'open': a connection is established with a signaling server
		 * 'close': a connection is disconnected from a signaling server
		 * 'error': network related error occurs
		 * 'connect': a connection is established with a remote peer
		 * 'disconnect': a connection is disconnected from a remote peer
		 * 'receive': receives remote data sent from a remote peer
		 * 'remote_stream': receives a remote media stream
		 *
		 * Arguments for callback functions are
		 * 'open': {string} local peer id
		 * 'close': {string} local peer id
		 * 'error': {string} error message
		 * 'connect': {string} remote peer id
		 *            {boolean} if a remote peer sends connection request
		 * 'disconnect': {string} remote peer id
		 * 'receive': {object} component object sent from remote peer
		 * 'remote_stream': {MediaStream} remote media stream
		 *
		 * @param {string} type - event type
		 * @param {function} func - callback function
		 */
		addEventListener: function ( type, func ) {

			switch ( type ) {

				case 'open':
					this.onOpens.push( func );
					break;

				case 'close':
					this.onCloses.push( func );
					break;

				case 'error':
					this.onErrors.push( func )
					break;

				case 'connect':
					this.onConnects.push( func )
					break;

				case 'disconnect':
					this.onDisconnects.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'remote_stream':
					this.onRemoteStreams.push( func );
					break;

				default:
					console.log( 'THREE.NetworkClient.addEventListener: Unknown type ' + type );
					break;

			}

		},

		/**
		 * Joins a room or connects a remote peer, depending on class.
		 * A child class must override this method.
		 * @param {string} id - room id or remote peer id, depending on class.
		 */
		connect: function ( id ) {},

		/**
		 * Sends data to a remote peer.
		 * @param {string} id - remote peer id
		 * @param {anything} data
		 */
		send: function ( id, data ) {},

		/**
		 * Broadcasts data to all connected peers.
		 * @param {anything} data
		 */
		broadcast: function ( data ) {},

		/**
		 * Checks if having a connection with a remote peer.
		 * @param {string} id - remote peer id
		 * @returns {boolean}
		 */
		hasConnection: function ( id ) {

			return this.connectionTable[ id ] !== undefined;

		},

		/**
		 * Returns the number of connections.
		 */
		connectionNum: function () {

			return this.connections.length;

		},

		// private (protected)

		/**
		 * Adds an connection object.
		 * @param {string} id - remote peer id
		 * @param {object} connection - an object which has remote peer id as .peer property
		 * @returns {boolean} if succeeded
		 */
		addConnection: function ( id, connection ) {

			if ( id === this.id || this.connectionTable[ id ] !== undefined ) return false;

			this.connections.push( connection );
			this.connectionTable[ id ] = connection;

			return true;

		},

		/**
		 * Removes an connection object.
		 * @param {string} id - remote peer id
		 * @returns {boolean} if succeeded
		 */
		removeConnection: function ( id ) {

			if ( id === this.id || this.connectionTable[ id ] === undefined ) return false;

			delete this.connectionTable[ id ];

			// TODO: optimize
			var readIndex = 0;
			var writeIndex = 0;

			for ( var i = 0, il = this.connections.length; i < il; i ++ ) {

				if ( this.connections[ readIndex ].peer !== id ) {

					this.connections[ writeIndex ] = this.connections[ readIndex ];
					writeIndex++;

				}

				readIndex++;

			}

			this.connections.length = writeIndex;

			return true;

		},

		// event listeners, refer to .addEventListeners() comment for the arguments.

		invokeOpenListeners: function ( id ) {

			this.id = id;

			for ( var i = 0, il = this.onOpens.length; i < il; i ++ ) {

				this.onOpens[ i ]( id );

			}

		},

		invokeCloseListeners: function ( id ) {

			for ( var i = 0, il = this.onCloses.length; i < il; i ++ ) {

				this.onCloses[ i ]( id );

			}

		},

		invokeErrorListeners: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		invokeConnectListeners: function ( id, fromRemote ) {

			for ( var i = 0, il = this.onConnects.length; i < il; i ++ ) {

				this.onConnects[ i ]( id, fromRemote );

			}

		},

		invokeDisconnectListeners: function ( id ) {

			for ( var i = 0, il = this.onDisconnects.length; i < il; i ++ ) {

				this.onDisconnects[ i ]( id );

			}

		},

		invokeReceiveListeners: function ( data ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( data );

			}

		},

		invokeRemoteStreamListeners: function ( stream ) {

			for ( var i = 0, il = this.onRemoteStreams.length; i < il; i ++ ) {

				this.onRemoteStreams[ i ]( stream );

			}

		}

	} );

} )();

( function () {

	/**
	 * Abstract signaling server class used for WebRTC connection establishment.
	 */
	THREE.SignalingServer = function () {

		this.id = '';  // local peer id, assigned when local peer connects the server
		this.roomId = '';

		// event listeners

		this.onOpens = [];
		this.onCloses = [];
		this.onErrors = [];
		this.onRemoteJoins = [];
		this.onReceives = [];

	};

	Object.assign( THREE.SignalingServer.prototype, {

		/**
		 * Adds EventListener. Callback function will be invoked when
		 * 'open': a connection is established with a signaling server
		 * 'close': a connection is disconnected from a signaling server
		 * 'error': error occurs
		 * 'receive': receives signal from a remote peer via server
		 * 'remote_join': aware of a remote peer joins the room
		 *
		 * Arguments for callback functions are
		 * 'open': {string} local peer id
		 * 'close': {string} local peer id
		 * 'error': {string} error message
		 * 'receive': {object} signal sent from a remote peer
		 * 'remote_join': {string} remote peer id
		 *                {number} timestamp when local peer joined the room
		 *                {number} timestamp when remote peer joined the room
		 *
		 * @param {string} type - event type
		 * @param {function} func - callback function
		 */
		addEventListener: function ( type, func ) {

			switch ( type ) {

				case 'open':
					this.onOpens.push( func );
					break;

				case 'close':
					this.onCloses.push( func );
					break;

				case 'error':
					this.onErrors.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'remote_join':
					this.onRemoteJoins.push( func );
					break;

				default:
					console.log( 'THREE.SignalingServer.addEventListener: Unknown type ' + type );
					break;

			}

		},

		// invoke event listeners. refer to .addEventListener() comment for arguments.

		invokeOpenListeners: function ( id ) {

			for ( var i = 0, il = this.onOpens.length; i < il; i ++ ) {

				this.onOpens[ i ]( id );

			}

		},

		invokeCloseListeners: function ( id ) {

			for ( var i = 0, il = this.onCloses.length; i < il; i ++ ) {

				this.onCloses[ i ]( id );

			}

		},

		invokeErrorListeners: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		invokeRemoteJoinListeners: function ( id, localTimestamp, remoteTimestamp ) {

			for ( var i = 0, il = this.onRemoteJoins.length; i < il; i ++ ) {

				this.onRemoteJoins[ i ]( id, localTimestamp, remoteTimestamp );

			}

		},

		invokeReceiveListeners: function ( signal ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( signal );

			}

		},

		// public abstract method

		/**
		 * Joins a room.
		 * @param {string} roomId
		 */
		connect: function ( roomId ) {},

		/**
		 * Sends signal.
		 * TODO: here assumes signal is broadcasted but we should
		 *       enable it to send signal to a peer?
		 * @param {object} signal
		 */
		send: function ( signal ) {}

	} );

} )();
