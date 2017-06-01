( function () {

	THREE.FirebaseSignalingServer = function ( params ) {

		if ( window.firebase === undefined ) {

			throw new Error( 'THREE.FirebaseSignalingServer: Import firebase from https://www.gstatic.com/firebasejs/x.x.x/firebase.js' );

		}

		this.id = '';
		this.roomId = '';

		this.apiKey = params.apiKey !== undefined ? params.apiKey : '';
		this.authDomain = params.authDomain !== undefined ? params.authDomain : '';
		this.databaseURL = params.databaseURL !== undefined ? params.databaseURL : '';
		this.authType = params.authType !== undefined ? params.authType : 'anonymous';

		this.onOpens = [];
		this.onCloses = [];
		this.onRemoteJoins = [];
		this.onReceives = [];
		this.onErrors = [];

		this.init();

	};

	Object.assign( THREE.FirebaseSignalingServer.prototype, {

		addEventListener: function ( type, func ) {

			switch ( type ) {

				case 'open':
					this.onOpens.push( func );
					break;

				case 'close':
					this.onCloses.push( func );
					break;

				case 'remotejoin':
					this.onRemoteJoins.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'error':
					this.onErrors.push( func );
					break;

				default:
					console.log( 'THREE.FirebaseSignalingServer.addEventListener: Unkknown type ' + type );
					break;

			}

		},

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
					console.log( 'THREE.FirebaseSignalingServer.auth: Unkown authType ' + this.authType );
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

				console.log( 'THREE.FirebaseSignalingServer.authAnonymous: ' + error );

				self.onError( error );

			} );

			firebase.auth().onAuthStateChanged( function ( user ) {

				if ( user === null ) {

					self.onClose( self.id );

				} else {

					self.id = user.uid;
					self.onOpen( self.id );

				}

			} );

		},

		connect: function ( roomId ) {

			var self = this;

			this.roomId = roomId;

			// TODO: check if this timescamp logic can race.
			this.getTimestamp( function( timestamp ) {

				var ref = firebase.database().ref( self.roomId + '/' + self.id );

				ref.set( { timestamp: timestamp, signal: '' } );

				ref.onDisconnect().remove();

				var table = {};

				firebase.database().ref( roomId ).on( 'child_added', function ( data ) {

					var id = data.key;

					if ( id === self.id || table[ id ] === true ) return;

					table[ id ] = true;

					var timestamp2 = data.val().timestamp;

					firebase.database().ref( self.roomId + '/' + id + '/signal' ).on( 'value', function ( data ) {

						if ( data.val() === null || data.val() === '' ) return;

						self.onReceive( data.val() );

					} );

					self.onRemoteJoin( {
						peer: id,
						joinTimestamp: timestamp,
						peerJoinTimestamp: timestamp2
					} );

				} );

				firebase.database().ref( roomId ).on( 'child_removed', function ( data ) {

					delete table[ data.key ];

				} );

			} );

		},

		getTimestamp: function ( callback ) {

			var ref = firebase.database().ref( 'tmp' + '/' + this.id );

			ref.set( firebase.database.ServerValue.TIMESTAMP );

			ref.once( 'value', function ( data ) {

				var timestamp = data.val();

				ref.remove();

				callback( timestamp );

			} );

			ref.onDisconnect().remove();

		},

		send: function ( data ) {

			firebase.database().ref( this.roomId + '/' + this.id + '/signal' ).set( data );

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

		onError: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		onRemoteJoin: function ( params ) {

			for ( var i = 0, il = this.onRemoteJoins.length; i < il; i ++ ) {

				this.onRemoteJoins[ i ]( params );

			}

		},

		onReceive: function ( signal ) {

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( signal );

			}

		}

	} );

} )();
