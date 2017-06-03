/**
 * @author Takahiro https://github.com/takahirox
 *
 * TODO:
 *   support all authorize types.
 */

( function () {

	/**
	 * FirebaseSignalingServer constructor.
	 * FirebaseSignalingServer uses Firebase as a signaling server.
	 * @param {object} params - parameters for instantiate and Firebase configuration (optional)
	 */
	THREE.FirebaseSignalingServer = function ( params ) {

		if ( window.firebase === undefined ) {

			throw new Error( 'THREE.FirebaseSignalingServer: Import firebase from https://www.gstatic.com/firebasejs/x.x.x/firebase.js' );

		}

		if ( params === undefined ) params = {};

		THREE.SignalingServer.call( this );

		// Refer to Frebase document for them
		this.apiKey = params.apiKey !== undefined ? params.apiKey : '';
		this.authDomain = params.authDomain !== undefined ? params.authDomain : '';
		this.databaseURL = params.databaseURL !== undefined ? params.databaseURL : '';

		this.authType = params.authType !== undefined ? params.authType : 'anonymous';

		this.init();
		this.auth();

	};

	THREE.FirebaseSignalingServer.prototype = Object.create( THREE.SignalingServer.prototype );
	THREE.FirebaseSignalingServer.prototype.constructor = THREE.FirebaseSignalingServer;

	Object.assign( THREE.FirebaseSignalingServer.prototype, {

		/**
		 * Initializes Firebase.
		 */
		init: function () {

			firebase.initializeApp( {
				apiKey: this.apiKey,
				authDomain: this.authDomain,
				databaseURL: this.databaseURL
			} );

		},

		/**
		 * Authorizes Firebase, depending on authorize type.
		 */
		auth: function () {

			switch ( this.authType ) {

				case 'none':
					this.authNone();
					break;

				case 'anonymous':
					this.authAnonymous();
					break;

				default:
					console.log( 'THREE.FirebaseSignalingServer.auth: Unknown authType ' + this.authType );
					break;

			}

		},

		/**
		 * Doesn't authorize.
		 */
		authNone: function () {

			var self = this;

			// makes an unique 16-char id by myself.
			var id = THREE.Math.generateUUID().replace( /-/g, '' ).toLowerCase().slice( 0, 16 );

			// asynchronously invokes open listeners for the compatibility with other auth types.
			requestAnimationFrame( function () {

				self.id = id;
				self.invokeOpenListeners( id );

			} );

		},

		/**
		 * Authorizes as anonymous.
		 */
		authAnonymous: function () {

			var self = this;

			firebase.auth().signInAnonymously().catch( function ( error ) {

				console.log( 'THREE.FirebaseSignalingServer.authAnonymous: ' + error );

				self.invokeErrorListeners( error );

			} );

			firebase.auth().onAuthStateChanged( function ( user ) {

				if ( user === null ) {

					// disconnected from server

					self.invokeCloseListeners( self.id );

				} else {

					// authorized

					self.id = user.uid;
					self.invokeOpenListeners( self.id );

				}

			} );

		},

		/**
		 * Gets server timestamp.
		 * @param {function} callback
		 */
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

		// public concrete method

		connect: function ( roomId ) {

			var self = this;

			this.roomId = roomId;

			// TODO: check if this timestamp logic can race.
			this.getTimestamp( function( timestamp ) {

				var ref = firebase.database().ref( self.roomId + '/' + self.id );

				ref.set( { timestamp: timestamp, signal: '' } );

				ref.onDisconnect().remove();

				var doneTable = {};  // remote peer id -> true or undefined, indicates if already done.

				firebase.database().ref( self.roomId ).on( 'child_added', function ( data ) {

					var id = data.key;

					if ( id === self.id || doneTable[ id ] === true ) return;

					doneTable[ id ] = true;

					var remoteTimestamp = data.val().timestamp;

					// received signal
					firebase.database().ref( self.roomId + '/' + id + '/signal' ).on( 'value', function ( data ) {

						if ( data.val() === null || data.val() === '' ) return;

						self.invokeReceiveListeners( data.val() );

					} );

					self.invokeRemoteJoinListeners(	id, timestamp, remoteTimestamp );

				} );

				firebase.database().ref( roomId ).on( 'child_removed', function ( data ) {

					delete doneTable[ data.key ];

				} );

			} );

		},

		// TODO: we should enable .send() to send signal to a peer, not only broadcast?
		send: function ( data ) {

			firebase.database().ref( this.roomId + '/' + this.id + '/signal' ).set( data );

		}

	} );

} )();
