( function () {

	var TRANSFER_TYPE_SYNC = 0;
	var TRANSFER_TYPE_ADD = 1;
	var TRANSFER_TYPE_REMOVE = 2;

	var TRANSFER_COMPONENT = {
		id: null,
		did: null,
		type: -1,
		list: []
	};

	var float32Value = new Float32Array( 1 );

	function ensureFloat32( value ) {

		float32Value[ 0 ] = value;
		return float32Value[ 0 ];

	}

	// TODO: support interpolation
	// TODO: support packet loss recover for UDP
	// TODO: proper error handling
	// TODO: optimize transfer component

	THREE.RemoteSync = function ( client ) {

		var self = this;

		this.client = client;

		this.id = client.id;

		this.localObjects = [];
		this.localObjectTable = {};
		this.localObjectInfos = {};

		this.remoteObjectTable = {};

		this.sharedObjects = [];
		this.sharedObjectTable = {};
		this.sharedObjectInfos = {};

		this.transferComponentsSync = {};

		this.onOpens = [];
		this.onCloses = [];
		this.onErrors = [];
		this.onConnects = [];
		this.onDisconnects = [];
		this.onReceives = [];
		this.onAdds = [];
		this.onRemoves = [];
		this.onRemoteStreams = [];

		this.client.addEventListener( 'open', function( id ) { self.onOpen( id ); } );
		this.client.addEventListener( 'close', function( id ) { self.onClose( id ); } );
		this.client.addEventListener( 'error', function( error ) { self.onError( error ); } );
		this.client.addEventListener( 'connect', function( id, fromRemote ) { self.onConnect( id, fromRemote ); } );
		this.client.addEventListener( 'disconnect', function( id ) { self.onDisconnect( id ); } );
		this.client.addEventListener( 'receive', function( data ) { self.onReceive( data ); } );
		this.client.addEventListener( 'remotestream', function( stream ) { self.onRemoteStream( stream ); } );

	};

	Object.assign( THREE.RemoteSync.prototype, {

		// public

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

				case 'add':
					this.onAdds.push( func );
					break;

				case 'remove':
					this.onRemoves.push( func );
					break;

				case 'remotestream':
					this.onRemoteStreams.push( func );
					break;

				default:
					console.log( 'THREE.RemoteSync.addEventListener: Unknown type ' + type );
					break;

			}

		},

		connect: function ( destId ) {

			this.client.connect( destId );

		},

		addLocalObject: function ( object, info ) {

			if ( this.localObjectTable[ object.uuid ] !== undefined ) return;

			if ( info === undefined ) info = {};

			this.localObjectTable[ object.uuid ] = object;
			this.localObjects.push( object );

			this.localObjectInfos[ object.uuid ] = info;

			var morphTargetInfluences = [];

			if ( object.morphTargetInfluences !== undefined ) {

				for ( var i = 0, il = object.morphTargetInfluences.length; i < il; i ++ ) {

					morphTargetInfluences[ i ] = object.morphTargetInfluences[ i ];

				}

			}

			this.transferComponentsSync[ object.uuid ] = {
				id: object.uuid,
				matrix: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ],
				morphTargetInfluences: morphTargetInfluences
			};

			if ( this.client.connectionNum() > 0 ) this.broadcastObjectAddition( object );

		},

		removeLocalObject: function ( object ) {

			delete this.localObjectTable[ object.uuid ];
			delete this.transferComponentsSync[ object.uuid ];

			var readIndex = 0;
			var writeIndex = 0;

			for ( var i = 0, il = this.localObjects.length; i < il; i ++ ) {

				if ( this.localObjects[ i ] === object ) {

					this.localObjects[ writeIndex ] = this.localObjects[ readIndex ];
					writeIndex ++;

				}

				readIndex ++;

			}

			this.localObjects.length = writeIndex;

			this.broadcastObjectRemoval( object );

		},

		addRemoteObject: function ( destId, objectId, object ) {

			if ( this.remoteObjectTable[ destId ] === undefined ) this.remoteObjectTable[ destId ] = {};

			var objects = this.remoteObjectTable[ destId ];

			if ( objects[ objectId ] !== undefined ) return;

			objects[ objectId ] = object;

		},

		addSharedObject: function ( object, id ) {

			if ( this.sharedObjectTable[ id ] !== undefined ) return;

			this.sharedObjectTable[ id ] = object;
			this.sharedObjects.push( object );

			var morphTargetInfluences = [];

			if ( object.morphTargetInfluences !== undefined ) {

				for ( var i = 0, il = object.morphTargetInfluences.length; i < il; i ++ ) {

					morphTargetInfluences[ i ] = object.morphTargetInfluences[ i ];

				}

			}

			this.transferComponentsSync[ object.uuid ] = {
				id: object.uuid,
				sid: id,
				matrix: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ],
				morphTargetInfluences: morphTargetInfluences
			};

		},

		removeSharedObject: function ( id ) {

			if ( this.sharedObjectTable[ id ] === undefined ) return;

			var object = this.sharedObjectTable[ id ];

			var readIndex = 0;
			var writeIndex = 0;

			for ( var i = 0, il = this.sharedObjects.length; i < il; i ++ ) {

				if ( this.sharedObjects[ i ] === object ) {

					this.sharedObjects[ writeIndex ] = this.sharedObjects[ readIndex ];
					writeIndex ++;

				}

				readIndex ++;

			}

			this.sharedObjects.length = writeIndex;

			delete this.sharedObjectTable[ id ];

		},

		sync: function ( force, onlyLocal ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.did = null;
			component.type = TRANSFER_TYPE_SYNC;

			var list = component.list;
			list.length = 0;

			for ( var i = 0, il = this.localObjects.length; i < il; i ++ ) {

				var object = this.localObjects[ i ];

				if ( force === true || this.checkUpdate( object ) ) {

					list.push( this.serialize( object ) );

				}

			}

			if ( onlyLocal !== true ) {

				for ( var i = 0, il = this.sharedObjects.length; i < il; i ++ ) {

					var object = this.sharedObjects[ i ];

					if ( force === true || this.checkUpdate( object ) ) {

						list.push( this.serialize( object ) );

					}

				}

			}

			if ( list.length > 0 ) this.client.broadcast( component );

		},

		// private

		removeRemoteObject: function ( destId, objectId ) {

			if ( this.remoteObjectTable[ destId ] === undefined ) return;

			var objects = this.remoteObjectTable[ destId ];

			if ( objects[ objectId ] === undefined ) return;

			var object = objects[ objectId ];

			delete objects[ objectId ];

			for ( var i = 0, il = this.onRemoves.length; i < il; i ++ ) {

				this.onRemoves[ i ]( destId, objectId, object );

			}

		},

		onOpen: function ( id ) {

			this.id = id;

			for ( var i = 0, il = this.onOpens.length; i < il; i ++ ) {

				this.onOpens[ i ]( id );

			}

		},

		onClose: function ( id ) {

			for ( var i = 0, il = this.onCloses.length; i < il; i ++ ) {

				this.onCloses[ i ]( id );

			}

		},

		onError: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		onConnect: function ( id, fromRemote ) {

			for ( var i = 0, il = this.onConnects.length; i < il; i ++ ) {

				this.onConnects[ i ]( id );

			}

			this.sendObjectsAddition( id );

			this.sync( true, ! fromRemote );

		},

		onDisconnect: function ( id ) {

			var objects = this.remoteObjectTable[ id ];

			if ( objects === undefined ) return;

			for ( var i = 0, il = this.onDisconnects.length; i < il; i ++ ) {

				this.onDisconnects[ i ]( id );

			}

			var keys = Object.keys( objects );

			for ( var i = 0, il = keys.length; i < il; i ++ ) {

				this.removeRemoteObject( id, keys[ i ] );

			}

		},

		createObjectsAdditionComponent: function () {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.did = null;
			component.type = TRANSFER_TYPE_ADD;

			var list = component.list;
			list.length = 0;

			for ( var i = 0, il = this.localObjects.length; i < il; i ++ ) {

				var object = this.localObjects[ i ];
				var info = this.localObjectInfos[ object.uuid ];

				list.push( { id: object.uuid, info: info } );

			}

			return component;

		},

		createObjectAdditionComponent: function ( object ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.did = null;
			component.type = TRANSFER_TYPE_ADD;

			var list = component.list;
			list.length = 0;

			var info = this.localObjectInfos[ object.uuid ];

			list.push( { id: object.uuid, info: info } );

			return component;

		},

		broadcastObjectAddition: function ( object ) {

			this.client.broadcast( this.createObjectAdditionComponent( object ) );

		},

		sendObjectsAddition: function ( destId ) {

			var component = this.createObjectsAdditionComponent();
			component.did = destId;

			this.client.send( destId, component );

		},

		broadcastObjectsAddition: function () {

			this.client.broadcast( this.createObjectsAdditionComponent() );

		},

		createObjectRemovalComponent: function ( object ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.did = null;
			component.type = TRANSFER_TYPE_REMOVE;

			var list = component.list;
			list.length = 0;

			list.push( { id: object.uuid } );

			return component;

		},

		broadcastObjectRemoval: function ( object ) {

			this.client.broadcast( this.createObjectRemovalComponent( object ) );

		},

		checkUpdate: function ( object ) {

			var component = this.transferComponentsSync[ object.uuid ];

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

		serialize: function ( object ) {

			var component = this.transferComponentsSync[ object.uuid ];

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

		deserialize: function ( object, component ) {

			var transferComponent = this.transferComponentsSync[ object.uuid ];

			object.matrix.fromArray( component.matrix );
			object.matrix.decompose( object.position, object.quaternion, object.scale );

			if ( object.morphTargetInfluences !== undefined && component.morphTargetInfluences.length > 0 ) {

				var array = component.morphTargetInfluences;
				var array2 = object.morphTargetInfluences;

				for ( var i = 0, il = array.length; i < il; i ++ ) {

					array2[ i ] = array[ i ];

				}

			}

		},

		onSync: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var objectId = list[ i ].id;
				var sharedId = list[ i ].sid;

				var object;

				if ( sharedId !== undefined ) {

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

		onReceive: function ( component ) {

			// if this data is not for me then ignore.
			if ( component.did !== undefined && component.did !== null && this.id !== component.did ) return;

			switch ( component.type ) {

				case TRANSFER_TYPE_SYNC:

					this.onSync( component );
					break;

				case TRANSFER_TYPE_ADD:

					this.onAdd( component );
					break;

				case TRANSFER_TYPE_REMOVE:

					this.onRemove( component );
					break;

				default:

					console.log( 'THREE.RemoteSync.unReceive: Unknown type ' + component.type );
					break;

			}

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( component );

			}

		},

		onAdd: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				if ( objects === undefined || objects[ list[ i ].id ] === undefined ) {

					for ( var j = 0, jl = this.onAdds.length; j < jl; j ++ ) {

						this.onAdds[ j ]( destId, list[ i ] );

					}

				}

			}

		},

		onRemove: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			if ( objects === undefined ) return;

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var objectId = list[ i ].id;

				this.removeRemoteObject( destId, list[ i ].id );

			}

		},

		onRemoteStream: function ( stream ) {

			for ( var i = 0, il = this.onRemoteStreams.length; i < il; i ++ ) {

				this.onRemoteStreams[ i ]( stream );

			}

		}

	} );

} )();

( function () {

	THREE.NetworkClient = function ( params ) {

		if ( params === undefined ) params = {};

		this.id = params.id !== undefined ? params.id : '';
		this.stream = params.stream !== undefined ? params.stream : null;

		this.roomId = '';

		this.connections = [];
		this.connectionTable = {};

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
		if ( params.onRemoteStream !== undefined ) this.addEventListener( 'remotestream', params.onRemoteStream );

	};

	Object.assign( THREE.NetworkClient.prototype, {

		// public

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

				case 'remotestream':
					this.onRemoteStreams.push( func );
					break;

				default:
					console.log( 'THREE.NetworkClient.addEventListener: Unknown type ' + type );
					break;

			}

		},

		connect: function ( destId ) {},

		send: function ( id, data ) {},

		broadcast: function ( data ) {},

		hasConnection: function ( id ) {

			return this.connectionTable[ id ] !== undefined;

		},

		connectionNum: function () {

			return this.connections.length;

		},

		// private (protected)

		onOpen: function ( id ) {

			for ( var i = 0, il = this.onOpens.length; i < il; i ++ ) {

				this.onOpens[ i ]( id );

			}

		},

		onClose: function ( id ) {

			for ( var i = 0, il = this.onCloses.length; i < il; i ++ ) {

				this.onCloses[ i ]( id );

			}

		},

		onError: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		onConnect: function ( id, fromRemote ) {

			for ( var i = 0, il = this.onConnects.length; i < il; i ++ ) {

				this.onConnects[ i ]( id, fromRemote );

			}

		},

		onDisconnect: function ( id ) {

			for ( var i = 0, il = this.onDisconnects.length; i < il; i ++ ) {

				this.onDisconnects[ i ]( id );

			}

		},

		onReceive: function ( data ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( data );

			}

		},

		onRemoteStream: function ( stream ) {

			for ( var i = 0, il = this.onRemoteStreams.length; i < il; i ++ ) {

				this.onRemoteStreams[ i ]( stream );

			}

		},

		addConnection: function ( id, connection ) {

			if ( id === this.id || this.connectionTable[ id ] !== undefined ) return false;

			this.connections.push( connection );
			this.connectionTable[ id ] = connection;

			return true;

		},

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

		}

	} );

} )();