/**
 * @author Takahiro https://github.com/takahirox
 */

( function () {

	/**
	 * FirebaseClient constructor.
	 * FirebaseClient transfers data via Realtime database.
	 * Note that this isn't WebRTC, so you can't transfer media streaming.
	 * @param {object} params - parameters for instantiate and Firebase configuration (optional)
	 */
	THREE.FirebaseClient = function ( params ) {

		if ( window.firebase === undefined ) {

			throw new Error( 'THREE.FirebaseClient: Import firebase from https://www.gstatic.com/firebasejs/x.x.x/firebase.js' );

		}

		if ( params === undefined ) params = {};

		THREE.NetworkClient.call( this, params );

		// Refer to Frebase document for them
		this.apiKey = params.apiKey !== undefined ? params.apiKey : '';
		this.authDomain = params.authDomain !== undefined ? params.authDomain : '';
		this.databaseURL = params.databaseURL !== undefined ? params.databaseURL : '';

		this.authType = params.authType !== undefined ? params.authType : 'anonymous';

		this.init();
		this.auth();

	};

	THREE.FirebaseClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.FirebaseClient.prototype.constructor = THREE.FirebaseClient;

	Object.assign( THREE.FirebaseClient.prototype, {

		/**
		 * Initializes Firebase.
		 * Note: share this code with FirebaseSignalingServer?
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
		 * Note: share this code with FirebaseSignalingServer?
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
					console.log( 'THREE.FilebaseClient.auth: Unkown authType ' + this.authType );
					break;

			}

		},

		/**
		 * Doesn't authorize.
		 * Note: share this code with FirebaseSignalingServer?
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
		 * Note: share this code with FirebaseSignalingServer?
		 */
		authAnonymous: function () {

			var self = this;

			firebase.auth().signInAnonymously().catch( function ( error ) {

				console.log( 'THREE.FirebaseClient.authAnonymous: ' + error );

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
		 * Adds connection.
		 * @param {string} id - remote peer id
		 * @param {boolean} fromRemote - if remote peer started connection process
		 */
		connected: function ( id, fromRemote ) {

			var self = this;

			if ( ! this.addConnection( id, { peer: id } ) ) return;

			firebase.database().ref( this.roomId + '/' + id + '/data' ).on( 'value', function ( data ) {

				if ( data.val() === null || data.val() === '' ) return;

				self.invokeReceiveListeners( data.val() );

			} );

			this.invokeConnectListeners( id, fromRemote );

		},

		/**
		 * Removes connection.
		 * @param {string} id - remote peer id
		 */
		removed: function ( id ) {

			if ( this.removeConnection( id ) ) this.invokeDisconnectListeners( id );

		},

		/**
		 * Gets server timestamp.
		 * Note: share this code with FirebaseSignalingServer?
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
			this.getTimestamp( function ( timestamp ) {

				var ref = firebase.database().ref( self.roomId + '/' + self.id );

				ref.set( { timestamp: timestamp, data: '' } );

				ref.onDisconnect().remove();

				firebase.database().ref( self.roomId ).on( 'child_added', function ( data ) {

					var remoteTimestamp = data.val().timestamp;

					var fromRemote = timestamp <= remoteTimestamp;

					self.connected( data.key, fromRemote );

				} );

				firebase.database().ref( self.roomId ).on( 'child_removed', function ( data ) {

					self.removed( data.key );

				} );

			} );

		},

		// TODO: enables data transfer to a specific peer, not broadcast?
		send: function ( id, data ) {

			this.broadcast( data );

		},

		broadcast: function ( data ) {

			firebase.database().ref( this.roomId + '/' + this.id + '/data' ).set( data );

		}

	} );

} )();
