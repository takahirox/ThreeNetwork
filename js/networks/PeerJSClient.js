/**
 * @author Takahiro https://github.com/takahirox
 */

( function () {

	/**
	 * PeerJSClient constructor.
	 * PeerJSClient is a PeerJS based NetworkClient concrete class.
	 * PeerJSClient acts depending on PeerJS server allow_discovery configuration.
	 * If allow_discovery is true, it acts as there is only one room in the PeerJS server.
	 * Otherwise, it acts as there is no room system in the server and connects a
	 * specified remote peer, exchanges the connected peers list, and then connects
	 * other listed peers (I call this snoop here).
	 * @param {object} params - instantiate parameters (optional)
	 */
	THREE.PeerJSClient = function ( params ) {

		if ( window.Peer === undefined ) {

			throw new Error( 'THREE.PeerJSClient: Import PeerJS from https://github.com/peers/peerjs.' );

		}

		if ( params === undefined ) params = {};

		THREE.NetworkClient.call( this, params );

		// Refer to PeerJS document for them.
		this.key = params.key !== undefined ? params.key : '';
		this.debugLevel = params.debugLevel !== undefined ? params.debugLevel : 0;
		this.host = params.host !== undefined ? params.host : '';
		this.port = params.port !== undefined ? params.port : null;
		this.path = params.path !== undefined ? params.path : '';

		// Set true if PeerJS server allow_discovery is true.
		this.allowDiscovery = params.allowDiscovery !== undefined ? params.allowDiscovery : false;

		this.peer = this.createPeer();

	};

	THREE.PeerJSClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.PeerJSClient.prototype.constructor = THREE.PeerJSClient;

	Object.assign( THREE.PeerJSClient.prototype, {

		// private

		/**
		 * Creates Peer instance.
		 * @returns {Peer}
		 */
		createPeer: function () {

			var self = this;

			var param = { debug: this.debugLevel };

			if ( this.key !== '' ) param.key = this.key;
			if ( this.host !== '' ) param.host = this.host;
			if ( this.port !== null ) param.port = this.port;
			if ( this.path !== '' ) param.path = this.path;

			var peer = this.id !== '' ? new Peer( this.id, param ) : new Peer( param );

			// connected with PeerJS server
			peer.on( 'open', function ( id ) {

				self.invokeOpenListeners( id );

			} );

			// disconnected from PeerJS server
			peer.on( 'close', function ( id ) {

				self.invokeCloseListeners( id );

			} );

			// connected with a remote peer
			peer.on( 'connection', function ( connection ) {

				self.connected( connection, true );

			} );

			// received a call(streaming) from a remote peer
			peer.on( 'call', function ( call ) {

				call.answer( self.stream );

				call.on( 'stream', function ( remoteStream ) {

					self.invokeRemoteStreamListeners( remoteStream );

				} );

			} );

			// error occurred with PeerJS server
			peer.on( 'error', function ( error ) {

				self.invokeErrorListeners( error );

			} );

			return peer;

		},

		/**
		 * Sets up and adds connection.
		 * @param {object} connection 
		 * @param {boolean} fromRemote - if a remote peer sends connection request
		 */
		connected: function ( connection, fromRemote ) {

			var self = this;

			var id = connection.peer;

			if ( ! this.addConnection( id, connection ) ) return;

			connection.on( 'open', function() {

				// received data from a remote peer
				connection.on( 'data', function( data ) {

					if ( data.type === SNOOPLIST_TYPE ) {

						self.snoop( data.list );

					} else {

						self.invokeReceiveListeners( data );

					}

				} );

				// disconnected from a remote peer
				connection.on( 'close', function () {

					if ( self.removeConnection( id ) ) {

						self.invokeDisconnectListeners( id );

					}

				} );

				// error occurred with a remote peer
				connection.on( 'error', function ( error ) {

					self.invokeErrorListeners( error );

				} );

				self.invokeConnectListeners( id, fromRemote );

				if ( ! self.allowDiscovery ) self.sendPeersList( id );

				if ( self.stream !== null && ! fromRemote ) self.call( id );

			} );

		},

		/**
		 * Sends connected peers list to a remote peer for snoop.
		 * @param {string} id - remote peer id
		 */
		sendPeersList: function ( id ) {

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

		/**
		 * Starts snoop.
		 * @param {Array} peers - peers list sent from a remote peer
		 */
		snoop: function ( peers ) {

			for ( var i = 0, il = peers.length; i < il; i ++ ) {

				var id = peers[ i ];

				if ( id === this.id || this.hasConnection( id ) ) continue;

				this.connect( id );

			}

		},

		/**
		 * Starts call(streaming).
		 * @param {string} id - remote peer id
		 */
		call: function ( id ) {

			var call = this.peer.call( id, this.stream );

			call.on( 'stream', function ( remoteStream ) {

				self.onRemoteStream( remoteStream );

			} );

		},

		// public concrete method

		connect: function ( destPeerId ) {

			if ( this.allowDiscovery ) {

				// ignores destPeerId because of only one room in PeerJS Server

				var self = this;

				// get peers list from the server and connects them

				this.peer.listAllPeers( function ( list ) {

					for ( var i = 0, il = list.length; i < il; i ++ ) {

						var id = list[ i ];

						if ( ! self.hasConnection( id ) ) {

							self.connected( self.peer.connect( id ), false );

						}

					}

				} );

			} else {

				// connects a specified remote peer

				this.connected( this.peer.connect( destPeerId ), false );

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

		}

	} );

	// component for snoop

	var SNOOPLIST_TYPE = 'snoop';

	var SNOOPLIST_COMPONENT = {
		type: SNOOPLIST_TYPE,
		list: []
	};

} )();
