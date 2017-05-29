( function () {

	var MESSAGE_TYPE = 'message';

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

		init: function () {

			var self = this;

			easyrtc.setPeerListener(

				function ( who, type, content, targeting ) {

					self.onReceive( content );

				}

			);

			easyrtc.setRoomOccupantListener(

				function ( name, occupants, primary ) {

					if ( name !== self.roomId ) return;

					var table = {};

					for ( var i = 0, il = self.connections.length; i < il; i ++ ) {

						table[ self.connections[ i ].peer ] = false;

					}

					var keys = Object.keys( occupants );

					for ( var i = 0, il = keys.length; i < il; i ++ ) {

						var key = keys[ i ];

						if ( table[ key ] === undefined ) {

							self.connected( occupants[ key ].easyrtcid, ! self.connecting );

						} else {

							table[ key ] = true;

						}

					}

					var keys = Object.keys( table );

					for ( var i = 0, il = keys.length; i < il; i ++ ) {

						var key = keys[ i ];

						if ( table[ key ] === false ) self.disconnected( key );

					}

					self.connecting = false;

				}

			);

			easyrtc.connect( this.appName,

				function ( id ) {

					self.id = id;

					self.onOpen( id );

				},

				function ( code, message ) {

					self.onError( code + ': ' + message );

				}

			);

		},

		connected: function ( id, fromRemote ) {

			if ( this.addConnection( id, { peer: id } ) ) this.onConnect( id, fromRemote );

		},

		disconnected: function ( id ) {

			if ( this.removeConnection( id ) ) this.onDisconnect( id );

		},

		connect: function ( id ) {

			this.roomId = id;

			this.connecting = true;

			easyrtc.joinRoom( id, null,

				function ( roomName ) {

				},

				function ( code, text, roomName ) {

					self.onError( roomName + ' ' + code + ': ' + text );

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

} )();
