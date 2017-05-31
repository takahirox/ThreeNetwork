( function () {

	var SNOOPLIST_TYPE = 'snoop';

	var SNOOPLIST_COMPONENT = {
		type: SNOOPLIST_TYPE,
		list: []
	};

	// TODO: support packet loss recover

	THREE.PeerJSClient = function ( params ) {

		if ( window.Peer === undefined ) {

			throw new Error( 'THREE.PeerJSClient: Import PeerJS from https://github.com/peers/peerjs.' );

		}

		if ( params === undefined ) params = {};

		THREE.NetworkClient.call( this, params );

		this.apikey = params.apikey !== undefined ? params.apikey : '';
		this.debugLevel = params.debugLevel !== undefined ? params.debugLevel : 0;
		this.allowDiscovery = params.allowDiscovery !== undefined ? params.allowDiscovery : false;

		this.peer = this.createPeer();

	};

	THREE.PeerJSClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.PeerJSClient.prototype.constructor = THREE.PeerJSClient;

	Object.assign( THREE.PeerJSClient.prototype, {

		createPeer: function () {

			var self = this;

			var param = { key: this.apikey, debug: this.debugLevel };

			var peer = this.id !== '' ? new Peer( this.id, param ) : new Peer( param );

			peer.on( 'open', function ( id ) {

				self.id = id;

				self.onOpen( id );

			} );

			peer.on( 'close', function ( id ) {

				self.onClose( id );

			} );

			peer.on( 'connection', function ( connection ) {

				self.connected( connection, true );

			} );

			peer.on( 'call', function ( call ) {

				call.answer( self.stream );

				call.on( 'stream', function ( remoteStream ) {

					self.onRemoteStream( remoteStream );

				} );

			} );

			peer.on( 'error', function ( error ) {

				self.onError( error );

			} );

			return peer;

		},

		connect: function ( destPeerId ) {

			if ( this.allowDiscovery ) {

				// ignores destPeerId (=roomId here) because of only one room in PeerJS Server

				var self = this;

				this.peer.listAllPeers( function ( list ) {

					for ( var i = 0, il = list.length; i < il; i ++ ) {

						var id = list[ i ];

						if ( ! self.hasConnection( id ) ) self.connected( self.peer.connect( id ), false );

					}

				} );

			} else {

				this.connected( this.peer.connect( destPeerId ), false );

			}

		},

		connected: function ( connection, fromRemote ) {

			var self = this;

			var id = connection.peer;

			if ( ! this.addConnection( id, connection ) ) return;

			connection.on( 'open', function() {

				connection.on( 'data', function( data ) {

					if ( data.type === SNOOPLIST_TYPE ) {

						self.snoop( data );

					} else {

						self.onReceive( data );

					}

				} );

				connection.on( 'close', function () {

					if ( self.removeConnection( id ) ) self.onDisconnect( id );

				} );

				connection.on( 'error', function ( error ) {

					self.onError( error );

				} );

				self.onConnect( id, fromRemote );

				if ( ! self.allowDiscovery ) self.sendSnoopList( id );

				if ( self.stream !== null && ! fromRemote ) self.call( id );

			} );

		},

		sendSnoopList: function ( id ) {

			var component = SNOOPLIST_COMPONENT;
			var list = component.list;
			list.length = 0;

			for ( var i = 0, il = this.connections.length; i < il; i ++ ) {

				var connection = this.connections[ i ];

				if ( connection.peer === this.id || connection.peer === id ) continue;

				list.push( connection.peer );

			}

			if ( list.length > 0 ) this.send( id, component );

		},

		snoop: function ( component ) {

			var list = component.list;

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var id = list[ i ];

				if ( id === this.id || this.hasConnection( id ) ) continue;

				this.connect( id );

			}

		},

		send: function ( id, data ) {

			var connection = this.connectionTable[ id ];

			if ( connection === undefined ) return;

			connection.send( data );

		},

		broadcast: function ( data ) {

			for ( var i = 0, il = this.connections.length; i < il; i ++ ) {

				this.send( this.connections[ i ].peer, data );

			}

		},

		call: function ( id ) {

			var call = this.peer.call( id, this.stream );

			call.on( 'stream', function ( remoteStream ) {

				self.onRemoteStream( remoteStream );

			} );

		}

	} );

} )();
