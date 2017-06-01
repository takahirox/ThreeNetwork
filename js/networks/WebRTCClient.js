( function () {

	THREE.WebRTCClient = function ( server, params ) {

		THREE.NetworkClient.call( this, params );

		this.server = server;

		this.init();

	};

	THREE.WebRTCClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.WebRTCClient.prototype.constructor = THREE.WebRTCClient;

	Object.assign( THREE.WebRTCClient.prototype, {

		init: function () {

			var self = this;

			this.server.addEventListener( 'open', function ( id ) { self.onOpen( id ); } );
			this.server.addEventListener( 'close', function ( id ) { self.onClose( id ); } );
			this.server.addEventListener( 'error', function ( error ) { self.onError( error ); } );

			this.server.addEventListener( 'receive', function ( signal ) {

				for ( var i = 0, il = self.connections.length; i < il; i ++ ) {

					self.connections[ i ].onReceiveSignal( signal );

				}

			} );

			this.server.addEventListener( 'remotejoin', function ( params ) {

				var id = params.peer;

				if ( id === self.id || self.hasConnection( id ) ) return;

				var timestamp = params.joinTimestamp;
				var timestamp2 = params.peerJoinTimestamp;

				// TODO: need a workaround for timestamp === timestamp2
				var connectFromMe = timestamp > timestamp2;

				var peer = new WebRTCPeer( self.id, id, self.server, self.stream );

				peer.addEventListener( 'open', function ( id ) {

					self.onConnect( id, ! connectFromMe );

				} );

				peer.addEventListener( 'close', function ( id ) {

					if ( self.removeConnection( id ) ) self.onDisconnect( id );

				} );

				peer.addEventListener( 'error', function ( error ) {

					self.onError( error );

				} );

				peer.addEventListener( 'receive', function ( message ) {

					self.onReceive( message );

				} );

				peer.addEventListener( 'receivestream', function ( stream ) {

					self.onRemoteStream( stream );

				} );

				self.addConnection( id, peer );

				if ( connectFromMe ) peer.offer();

			} );

			if ( this.server.id !== '' ) {

				requestAnimationFrame( function () { self.onOpen( self.server.id ); } );

			}

		},

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

	var ICE_SERVERS = [
		{ url: 'stun:stun.l.google.com:19302' },
		{ url: 'stun:stun1.l.google.com:19302' },
		{ url: 'stun:stun2.l.google.com:19302' },
		{ url: 'stun:stun3.l.google.com:19302' },
		{ url: 'stun:stun4.l.google.com:19302' }
	];

	var WebRTCPeer = function ( id, peer, server, stream ) {

		this.id = id;
		this.peer = peer;
		this.server = server;
		this.pc = this.createPeerConnection( stream );

		this.onOpens = [];
		this.onCloses = [];
		this.onReceives = [];
		this.onReceiveStreams = [];
		this.onErrors = [];

	};

	Object.assign( WebRTCPeer.prototype, {

		addEventListener: function ( type, func ) {

			switch ( type ) {

				case 'open':
					this.onOpens.push( func );
					break;

				case 'close':
					this.onCloses.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'receivestream':
					this.onReceiveStreams.push( func );
					break;

				case 'error':
					this.onErrors.push( func );
					break;

				default:
					console.log( 'WebRTCPeer.addEventListener: Unkown type ' + type );
					break;

			}

		},

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

		onReceive: function ( message ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( message );

			}

		},

		onReceiveStream: function ( stream ) {

			for ( var i = 0, il = this.onReceiveStreams.length; i < il; i ++ ) {

				this.onReceiveStreams[ i ]( stream );

			}

		},

		onError: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		createPeerConnection: function ( stream ) {

			var self = this;

			var RTCPeerConnection = window.RTCPeerConnection ||
						window.webkitRTCPeerConnection ||
						window.mozRTCPeerConnection ||
						window.msRTCPeerConnection;

			if ( RTCPeerConnection === undefined ) {

				throw new Error( 'Peer: This browser does not seem to support WebRTC.' );

			}

			var pc = new RTCPeerConnection( { 'iceServers': ICE_SERVERS } );

			if ( stream !== null ) pc.addStream( stream );

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

				self.onReceiveStream( event.stream );

			};

			return pc;

		},

		onReceiveSignal: function ( signal ) {

			if ( this.id !== signal.peer || this.peer !== signal.id ) return;

			switch ( signal.type ) {

				case 'offer':
					this.onReceiveOffer( signal );
					break;

				case 'answer':
					this.onReceiveAnswer( signal );
					break;

				case 'candidate':
					this.onReceiveCandidate( signal );
					break;

				default:
					console.log( 'WebRTCPeer: Unknown signal type ' + signal.type );
					break;

			}

		},

		onReceiveOffer: function ( message ) {

			var self = this;

			this.pc.ondatachannel = function ( event ) {

				self.channel = event.channel;
				self.setupChannelListener();

			};

			this.setRemoteDescription( message );

			this.pc.createAnswer(

				function ( sdp ) {

					self.onReceiveSDP( sdp );

				},

				function ( error ) {

					console.log( error );
					self.onError( error );

				}

			);

		},

		onReceiveAnswer: function ( message ) {

			this.setRemoteDescription( message );

		},

		onReceiveCandidate: function ( message ) {

			var self = this;

			var RTCIceCandidate = window.RTCIceCandidate ||
						window.webkitRTCIceCandidate ||
						window.mozRTCIceCandidate;

			this.pc.addIceCandidate(

				new RTCIceCandidate( message ),

				function () {},

				function ( error ) {

					console.log( error );
					self.onError( error );

				}

			);

		},

		onReceiveSDP: function ( sdp ) {

			var self = this;

			this.pc.setLocalDescription( sdp,

				function () {},

				function ( error ) {

					console.log( error );
					self.onError( error );

				}

			);

			this.server.send( {
				id: this.id,
				peer: this.peer,
				type: sdp.type,
				sdp: sdp.sdp
			} );

		},

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

					console.log( error );
					self.onError( error );

				}

			);

		},

		offer: function () {

			var self = this;

			this.channel = this.pc.createDataChannel( 'mychannel', { reliable: false } );

			this.setupChannelListener();

			this.pc.createOffer(

				function ( sdp ) {

					self.onReceiveSDP( sdp );

				},

				function ( error ) {

					console.log( error );
					self.onError( error );

				}

			);

		},

		send: function ( data ) {

			this.channel.send( JSON.stringify( data ) );

		},

		setupChannelListener: function ( channel ) {

			var self = this;

			this.channel.onmessage = function ( event ) {

				self.onReceive( JSON.parse( event.data ) );

			};

			this.channel.onopen = function ( event ) {

				self.onOpen( self.peer );

			};

			this.channel.onclose = function ( event ) {

				self.onClose( self.peer );

			};

			this.channel.onerror = function( error ) {

				self.onError( error );

			};

		}

	} );

} )();
