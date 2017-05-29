( function () {

	var INIT_VALUE = 0;

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

			var connecting = true;

			var ref = firebase.database().ref( roomId + '/' + this.id );

			ref.set( INIT_VALUE );
			ref.onDisconnect().remove();

			firebase.database().ref( roomId ).on( 'child_added', function ( data ) {

				self.connected( data.key, ! connecting );

				connecting = false;

			} );

			firebase.database().ref( roomId ).on( 'child_removed', function ( data ) {

				self.removed( data.key );

			} );

		},

		connected: function ( id, fromRemote ) {

			var self = this;

			if ( ! this.addConnection( id, { peer: id } ) ) return;

			firebase.database().ref( this.roomId + '/' + id ).on( 'value', function ( data ) {

				if ( data.val() === null || data.val() === INIT_VALUE ) return;

				self.onReceive( data.val() );

			} );

			this.onConnect( id, fromRemote );

		},

		removed: function ( id ) {

			if ( this.removeConnection( id ) ) this.onDisconnect( id );

		},

		send: function ( id, data ) {

			this.broadcast( data );

		},

		broadcast: function ( data ) {

			firebase.database().ref( this.roomId + '/' + this.id ).set( data );

		}

	} );

} )();
