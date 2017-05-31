( function () {

	THREE.FirebaseClient = function ( params ) {

		if ( window.firebase === undefined ) {

			throw new Error( 'THREE.FirebaseClient: Import firebase from https://www.gstatic.com/firebasejs/x.x.x/firebase.js' );

		}

		THREE.NetworkClient.call( this, params );

		this.apiKey = params.apiKey !== undefined ? params.apiKey : '';
		this.authDomain = params.authDomain !== undefined ? params.authDomain : '';
		this.databaseURL = params.databaseURL !== undefined ? params.databaseURL : '';
		this.authType = params.authType !== undefined ? params.authType : 'anonymous';

		this.init();

	};

	THREE.FirebaseClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.FirebaseClient.prototype.constructor = THREE.FirebaseClient;

	Object.assign( THREE.FirebaseClient.prototype, {

		init: function () {

			firebase.initializeApp( {
				apiKey: this.apiKey,
				authDomain: this.authDomain,
				databaseURL: this.databaseURL
			} );

			this.auth();

		},

		auth: function () {

			switch ( this.authType ) {

				case 'none':
					this.authNone();
					break;

				case 'anonymous':
					this.authAnonymous();
					break;

				default:
					console.log( 'THREE.FilebaseClient.auth: Unkown authType ' + this.authType );
					break;

			}

		},

		authNone: function () {

			var self = this;

			requestAnimationFrame( function () {

				var id = THREE.Math.generateUUID().replace( /-/g, '' ).toLowerCase().slice( 0, 16 );
				self.id = id;
				self.onOpen( id );

			} );

		},

		authAnonymous: function () {

			var self = this;

			firebase.auth().signInAnonymously().catch( function ( error ) {

				console.log( 'THREE.FirebaseClient.authAnonymous: ' + error );

				self.onError( error );

			} );

			firebase.auth().onAuthStateChanged( function ( user ) {

				if ( user === null ) {

					self.onClose( self.id );

				} else {

					self.id = user.uid;
					self.onOpen( user.uid );

				}

			} );

		},

		connect: function ( roomId ) {

			var self = this;

			this.roomId = roomId;

			// TODO: check if this timescamp logic can race.
			this.getTimeStamp( function( timestamp ) {

				var ref = firebase.database().ref( roomId + '/' + self.id );

				ref.set( { timestamp: timestamp, signal: '' } );

				ref.onDisconnect().remove();

				firebase.database().ref( roomId ).on( 'child_added', function ( data ) {

					var id = data.key;

					if ( id === self.id || self.hasConnection( id ) ) return;

					var timestamp2 = data.val().timestamp;

					// TODO: need a workaround for timestamp === timestamp2
					var connectFromMe = timestamp > timestamp2;

					var peer = new WebRTCPeer( self.id, id, self, self.stream );

					peer.addEventListener( 'open', function ( id ) {

						self.onConnect( id, ! connectFromMe );

					} );

					peer.addEventListener( 'close', function ( id ) {

						if ( self.removeConnection( id ) ) self.onDisconnect( id );

					} );

					firebase.database().ref( self.roomId + '/' + id + '/signal' ).on( 'value', function ( data ) {

						if ( data.val() === null || data.val() === '' ) return;

						peer.onReceiveSignal( data.val() );

					} );

					self.addConnection( id, peer );

					if ( connectFromMe ) peer.offer();

				} );

			} );

		},

		getTimeStamp: function ( callback ) {

			var ref = firebase.database().ref( 'tmp' + '/' + this.id );

			ref.set( firebase.database.ServerValue.TIMESTAMP );

			ref.once( 'value', function ( data ) {

				var timestamp = data.val();

				ref.remove();

				callback( timestamp );

			} );

			ref.onDisconnect().remove();

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

		sendSignal: function ( data ) {

			firebase.database().ref( this.roomId + '/' + this.id + '/signal' ).set( data );

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
						peer: self.peer,
						type: 'candidate',
						sdpMLineIndex: event.candidate.sdpMLineIndex,
						candidate: event.candidate.candidate
					};

					self.server.sendSignal( params );

				}

			};

			pc.onaddstream = function ( event ) {

				self.server.onRemoteStream( event.stream );

			};

			return pc;

		},

		onReceiveSignal: function ( signal ) {

			if ( this.id !== signal.peer ) return;

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
					self.server.onError( error );

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
					self.server.onError( error );

				}

			);

		},

		onReceiveSDP: function ( sdp ) {

			var self = this;

			this.pc.setLocalDescription( sdp,

				function () {},

				function ( error ) {

					console.log( error );
					self.server.onError( error );

				}

			);

			this.server.sendSignal( {
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
					self.server.onError( error );

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
					self.server.onError( error );

				}

			);

		},

		send: function ( data ) {

			this.channel.send( JSON.stringify( data ) );

		},

		setupChannelListener: function ( channel ) {

			var self = this;

			this.channel.onmessage = function ( event ) {

				self.server.onReceive( JSON.parse( event.data ) );

			};

			this.channel.onopen = function ( event ) {

				self.onOpen( self.peer );

			};

			this.channel.onclose = function ( event ) {

				self.onClose( self.peer );

			};

			this.channel.onerror = function( error ) {

				self.server.onError( error );

			};

		}

	} );

} )();
