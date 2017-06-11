/**
 * @author Takahiro https://github.com/takahirox
 */

( function () {

	/**
	 * WebRTCClient constructor.
	 * General WebRTC Client, establishes a connection via Signaling server.
	 * @param {THREE.SignalingServer} server
	 * @param {object} params - parameters for instantiate (optional)
	 */
	THREE.WebRTCClient = function ( server, params ) {

		if ( params === undefined ) params = {};

		THREE.NetworkClient.call( this, params );

		this.server = server;

		this.init();

	};

	THREE.WebRTCClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.WebRTCClient.prototype.constructor = THREE.WebRTCClient;

	Object.assign( THREE.WebRTCClient.prototype, {

		/**
		 * Initializes signaling server event listener.
		 */
		init: function () {

			var self = this;

			// connected with server
			this.server.addEventListener( 'open',

				function ( id ) {

					self.invokeOpenListeners( id );

				}

			);

			// disconnected from server
			this.server.addEventListener( 'close',

				function ( id ) {

					self.invokeCloseListeners( id );

				}

			);

			// error occurred with server
			this.server.addEventListener( 'error',

				function ( error ) {

					self.invokeErrorListeners( error );

				}

			);

			// aware of a remote peer join the room
			this.server.addEventListener( 'remote_join', function ( id, localTimestamp, remoteTimestamp ) {

				if ( id === self.id || self.hasConnection( id ) ) return;

				// TODO: need a workaround for localTimestamp === remoteTimestamp
				var connectFromMe = localTimestamp > remoteTimestamp;

				var peer = new WebRTCPeer( self.id, id, self.server, self.stream );

				// received signal from a remote peer via server
				self.server.addEventListener( 'receive',

					function ( signal ) {

						peer.handleSignal( signal );

					}

				);

				// connected with a remote peer
				peer.addEventListener( 'open', function ( id ) {

					if ( self.addConnection( id, peer ) ) {

						self.invokeConnectListeners( id, ! connectFromMe );

					}

					// TODO: remove server 'receive' listener here.
					//       if .addConnection() fails here?

				} );

				// disconnected from a remote peer
				peer.addEventListener( 'close', function ( id ) {

					if ( self.removeConnection( id ) ) {

						// TODO: remove server 'receive' listener here.

						self.invokeDisconnectListeners( id );

					}

				} );

				// error occurred with a remote peer
				peer.addEventListener( 'error', function ( error ) {

					self.invokeErrorListeners( error );

				} );

				// received data from a remote peer
				peer.addEventListener( 'receive', function ( data ) {

					self.invokeReceiveListeners( data );

				} );

				// received remote media streaming
				peer.addEventListener( 'receive_stream', function ( stream ) {

					self.invokeRemoteStreamListeners( stream );

				} );

				if ( connectFromMe ) peer.offer();

			} );

			// for the compatibility with other NetworkClient classes.
			// if already connected with signaling server, asynchronously invokes open listeners.
			if ( this.server.id !== '' ) {

				requestAnimationFrame(

					function () {

						self.invokeOpenListeners( self.server.id );

					}

				);

			}

		},

		// public concrete method

		connect: function ( roomId ) {

			var self = this;

			this.roomId = roomId;

			this.server.connect( roomId );

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

	// ice servers for RTCPeerConnection.

	var ICE_SERVERS = [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' },
		{ urls: 'stun:stun2.l.google.com:19302' },
		{ urls: 'stun:stun3.l.google.com:19302' },
		{ urls: 'stun:stun4.l.google.com:19302' }
	];

	/**
	 * WebRTCPeer constructor.
	 * WebRTCPeer handles WebRTC connection and data transfer with RTCPeerConnection.
	 * Refer to RTCPeerConnection document for the message handling detail.
	 * @param {string} id - local peer id
	 * @param {string} peer - remote peer id
	 * @param {SignalingServer} server
	 * @param {MediaStream} stream - sends media stream to remote peer if it's provided (optional)
	 */
	var WebRTCPeer = function ( id, peer, server, stream ) {

		this.id = id;
		this.peer = peer;
		this.server = server;
		this.pc = this.createPeerConnection( stream );
		this.channel = null;

		this.open = false;

		// event listeners

		this.onOpens = [];
		this.onCloses = [];
		this.onErrors = [];
		this.onReceives = [];
		this.onReceiveStreams = [];

	};

	Object.assign( WebRTCPeer.prototype, {

		/**
		 * Adds EventListener. Callback function will be invoked when
		 * 'open': a connection is established with a remote peer
		 * 'close': a connection is disconnected from a remote peer
		 * 'error': error occurs
		 * 'receive': receives data from a remote peer
		 * 'remote_stream': receives a remote media stream
		 *
		 * Arguments for callback functions are
		 * 'open': {string} local peer id
		 * 'close': {string} local peer id
		 * 'error': {string} error message
		 * 'receive': {anything} signal sent from a remote peer
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
					this.onErrors.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'receive_stream':
					this.onReceiveStreams.push( func );
					break;

				default:
					console.log( 'WebRTCPeer.addEventListener: Unknown type ' + type );
					break;

			}

		},

		/**
		 * Creates peer connection.
		 * @param {MediaStream} stream - sends media stream to remote if it's provided (optional)
		 * @returns {RTCPeerConnection}
		 */
		createPeerConnection: function ( stream ) {

			var self = this;

			var RTCPeerConnection = window.RTCPeerConnection ||
						window.webkitRTCPeerConnection ||
						window.mozRTCPeerConnection ||
						window.msRTCPeerConnection;

			if ( RTCPeerConnection === undefined ) {

				throw new Error( 'WebRTCPeer.createPeerConnection: This browser does not seem to support WebRTC.' );

			}

			var pc = new RTCPeerConnection( { 'iceServers': ICE_SERVERS } );

			if ( stream !== null && stream !== undefined ) pc.addStream( stream );

			pc.onicecandidate = function ( event ) {

				if ( event.candidate ) {

					var params = {
						id: self.id,
						peer: self.peer,
						type: 'candidate',
						sdpMLineIndex: event.candidate.sdpMLineIndex,
						candidate: event.candidate.candidate
					};

					self.server.send( params );

				}

			};

			pc.onaddstream = function ( event ) {

				self.invokeReceiveStreamListeners( event.stream );

			};

			// Note: seems like channel.onclose hander is unreliable on some platforms,
			//       so also try to detect disconnection here.
			pc.oniceconnectionstatechange = function() {

				if( self.open && pc.iceConnectionState == 'disconnected' ) {

					self.open = false;

					self.invokeCloseListeners( self.peer );

				}

			};

			return pc;

		},

		/**
		 * Handles offer request.
		 * @param {object} message - message sent from a remote peer
		 */
		handleOffer: function ( message ) {

			var self = this;

			this.pc.ondatachannel = function ( event ) {

				self.channel = event.channel;
				self.setupChannelListener();

			};

			this.setRemoteDescription( message );

			this.pc.createAnswer(

				function ( sdp ) {

					self.handleSessionDescription( sdp );

				},

				function ( error ) {

					console.log( 'WebRTCPeer.handleOffer: ' + error );
					self.invokeErrorListeners( error );

				}

			);

		},

		/**
		 * Handles answer response.
		 * @param {object} message - message sent from a remote peer
		 */
		handleAnswer: function ( message ) {

			this.setRemoteDescription( message );

		},

		/**
		 * Handles candidate sent from a remote peer.
		 * @param {object} message - message sent from a remote peer
		 */
		handleCandidate: function ( message ) {

			var self = this;

			var RTCIceCandidate = window.RTCIceCandidate ||
						window.webkitRTCIceCandidate ||
						window.mozRTCIceCandidate;

			this.pc.addIceCandidate(

				new RTCIceCandidate( message ),

				function () {},

				function ( error ) {

					console.log( 'WebRTCPeer.handleCandidate: ' + error );
					self.invokeErrorListeners( error );

				}

			);

		},

		/**
		 * Handles SessionDescription.
		 * @param {RTCSessionDescription} sdp
		 */
		handleSessionDescription: function ( sdp ) {

			var self = this;

			this.pc.setLocalDescription( sdp,

				function () {},

				function ( error ) {

					console.log( 'WebRTCPeer.handleSessionDescription: ' + error );
					self.invokeErrorListeners( error );

				}

			);

			this.server.send( {
				id: this.id,
				peer: this.peer,
				type: sdp.type,
				sdp: sdp.sdp
			} );

		},

		/**
		 * Sets remote description.
		 * @param {object} message - message sent from a remote peer
		 */
		setRemoteDescription: function ( message ) {

			var self = this;

			var RTCSessionDescription = window.RTCSessionDescription ||
							window.webkitRTCSessionDescription ||
							window.mozRTCSessionDescription ||
							window.msRTCSessionDescription;

			this.pc.setRemoteDescription(

				new RTCSessionDescription( message ),

				function () {},

				function ( error ) {

					console.log( 'WebRTCPeer.setRemoteDescription: ' + error );
					self.invokeErrorListeners( error );

				}

			);

		},

		/**
		 * Sets up channel listeners.
		 */
		setupChannelListener: function () {

			var self = this;

			// received data from a remote peer
			this.channel.onmessage = function ( event ) {

				self.invokeReceiveListeners( JSON.parse( event.data ) );

			};

			// connected with a remote peer
			this.channel.onopen = function ( event ) {

				self.open = true;

				self.invokeOpenListeners( self.peer );

			};

			// disconnected from a remote peer
			this.channel.onclose = function ( event ) {

				if ( ! self.open ) return;

				self.open = false;

				self.invokeCloseListeners( self.peer );

			};

			// error occurred with a remote peer
			this.channel.onerror = function( error ) {

				self.invokeErrorListeners( error );

			};

		},

		// event listeners, refer to .addEventListeners() comment for the arguments.

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

		invokeReceiveListeners: function ( message ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( message );

			}

		},

		invokeReceiveStreamListeners: function ( stream ) {

			for ( var i = 0, il = this.onReceiveStreams.length; i < il; i ++ ) {

				this.onReceiveStreams[ i ]( stream );

			}

		},

		// public

		/**
		 * Sends connection request (offer) to a remote peer.
		 */
		offer: function () {

			var self = this;

			this.channel = this.pc.createDataChannel( 'mychannel', { reliable: false } );

			this.setupChannelListener();

			this.pc.createOffer(

				function ( sdp ) {

					self.handleSessionDescription( sdp );

				},

				function ( error ) {

					console.log( error );
					self.onError( error );

				}

			);

		},

		/**
		 * Sends data to a remote peer.
		 * @param {anything} data
		 */
		send: function ( data ) {

			// TODO: throw error?
			if ( this.channel === null || this.channel.readyState !== 'open' ) return;

			this.channel.send( JSON.stringify( data ) );

		},

		/**
		 * Handles signal sent from a remote peer via server.
		 * @param {object} signal - must have .peer as destination peer id and .id as source peer id
		 */
		handleSignal: function ( signal ) {

			// ignores signal if it isn't for me
			if ( this.id !== signal.peer || this.peer !== signal.id ) return;

			switch ( signal.type ) {

				case 'offer':
					this.handleOffer( signal );
					break;

				case 'answer':
					this.handleAnswer( signal );
					break;

				case 'candidate':
					this.handleCandidate( signal );
					break;

				default:
					console.log( 'WebRTCPeer: Unknown signal type ' + signal.type );
					break;

			}

		}

	} );

} )();
