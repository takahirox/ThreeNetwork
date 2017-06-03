/**
 * @author Takahiro https://github.com/takahirox
 *
 * TODO
 *   support media streaming
 *   optimize?
 */

( function () {

	/**
	 * EasyRTCClient constructor.
	 * EasyRTCClient is a EasyRTC based NetworkClient concrete class.
	 * @param {object} params - instantiate parameters (optional)
	 */
	THREE.EasyRTCClient = function ( params ) {

		if ( window.easyrtc === undefined ) {

			throw new Error( 'THREE.EasyRTCClient: Import EasyRTC from https://github.com/priologic/easyrtc.' );

		}

		if ( params === undefined ) params = {};

		THREE.NetworkClient.call( this, params );

		this.appName = params.appName !== undefined ? params.appName : 'easyrtc.three';

		this.connecting = false;

		this.init();

	};

	THREE.EasyRTCClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.EasyRTCClient.prototype.constructor = THREE.EasyRTCClient;

	Object.assign( THREE.EasyRTCClient.prototype, {

		/**
		 * Initializes EasyRTC.
		 */
		init: function () {

			var self = this;

			// received data from a remote peer
			easyrtc.setPeerListener(

				function ( who, type, content, targeting ) {

					self.invokeReceiveListeners( content );

				}

			);

			// peer joined the room
			easyrtc.setRoomOccupantListener(

				function ( name, occupants, primary ) {

					if ( name !== self.roomId ) return;

					// It seems like occupants includes all peers list in the room.
					// Then makes new connections with peers which aren't in self.connections,
					// and disconnects from peers which are in self.connections but not in occupants.

					var table = {};

					for ( var i = 0, il = self.connections.length; i < il; i ++ ) {

						table[ self.connections[ i ].peer ] = false;

					}

					var keys = Object.keys( occupants );

					for ( var i = 0, il = keys.length; i < il; i ++ ) {

						var key = keys[ i ];

						if ( table[ key ] === undefined ) {

							// a peer newly joined the room

							self.connected( occupants[ key ].easyrtcid, ! self.connecting );

						} else {

							table[ key ] = true;

						}

					}

					var keys = Object.keys( table );

					for ( var i = 0, il = keys.length; i < il; i ++ ) {

						var key = keys[ i ];

						if ( table[ key ] === false ) {

							// a peer left the room

							self.disconnected( key );

						}

					}

					self.connecting = false;

				}

			);

			// connects server
			easyrtc.connect( this.appName,

				function ( id ) {

					self.invokeOpenListeners( id );

				},

				function ( code, message ) {

					self.invokeErrorListeners( code + ': ' + message );

				}

			);

		},

		/**
		 * Adds connection.
		 * @param {string} id - remote peer id
		 * @param {boolean} fromRemote - if remote peer starts connection process
		 */
		connected: function ( id, fromRemote ) {

			if ( this.addConnection( id, { peer: id } ) ) {

				this.invokeConnectListeners( id, fromRemote );

			}

		},

		/**
		 * Removes connection.
		 * @param {string} id - remote peer id
		 */
		disconnected: function ( id ) {

			if ( this.removeConnection( id ) ) {

				this.invokeDisconnectListeners( id );

			}

		},

		// public concrete method

		connect: function ( id ) {

			this.roomId = id;

			this.connecting = true;

			easyrtc.joinRoom( id, null,

				function ( roomName ) {},

				function ( code, text, roomName ) {

					self.invokeErrorListeners( roomName + ' ' + code + ': ' + text );

				}

			);


		},

		send: function ( destId, data ) {

			easyrtc.sendPeerMessage( destId, MESSAGE_TYPE, data );

		},

		broadcast: function ( data ) {

			for ( var i = 0, il = this.connections.length; i < il; i ++ ) {

				this.send( this.connections[ i ].peer, data );

			}

		}

	} );

	var MESSAGE_TYPE = 'message';

} )();
