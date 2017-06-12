( function () {

	THREE.Physics = function ( params ) {

		if ( window.Ammo === undefined ) {

			throw new Error( 'import ammo.js' );

		}

		if ( params === undefined ) params = {};

		this.unitStep = ( params.unitStep !== undefined ) ? params.unitStep : 1 / 60;
		this.maxStepNum = ( params.maxStepNum !== undefined ) ? params.maxStepNum : 3;

		this.objects = [];
		this.bodies = [];
		this.bodyTable = {}; // object.uuid -> rigid body

		this.world = this.createWorld();

	}

	Object.assign( THREE.Physics.prototype, {

		// private

		createWorld: function () {

			var config = new Ammo.btDefaultCollisionConfiguration();
			var dispatcher = new Ammo.btCollisionDispatcher( config );
			var cache = new Ammo.btDbvtBroadphase();
			var solver = new Ammo.btSequentialImpulseConstraintSolver();
			var world = new Ammo.btDiscreteDynamicsWorld( dispatcher, cache, solver, config );
			world.setGravity( new Ammo.btVector3( 0, -9.8 * 10, 0 ) );
			return world;

		},

		createRigidBody: function ( object, params ) {

			if ( params === undefined ) params = {};

			var type = params.type !== undefined ? params.type : 'static';
			var shapeType = params.shapeType !== undefined ? params.shapeType : 'sphere';
			var weight = ( type === 'static' || params.weight === undefined ) ? 0 : params.weight;
			var width = params.width !== undefined ? params.width : 0.1;
			var height = params.height !== undefined ? params.height : 0.1;
			var depth = params.depth !== undefined ? params.depth : 0.1;
			var friction = params.friction !== undefined ? params.friction: 0.5;
			var restitution = params.restitution !== undefined ? params.restitution: 0.5;
			var groupIndex = params.groupIndex !== undefined ? params.groupIndex : 0;
			var groupTarget = params.groupTarget !== undefined ? params.groupTarget : 1;

			var shape;

			switch ( shapeType ) {

				case 'sphere':
					shape = new Ammo.btSphereShape( width );
					break;

				case 'box':
					var v = allocVector3();
					v.setValue( width, height, depth );
					shape = new Ammo.btBoxShape( v );
					freeVector3( v );
					break;

				case 'capsule':
					shape = new Ammo.btCapsuleShape( width, height );
					break;

				default:
					throw 'unknown shape type ' + shapeType;

			}

			var localInertia = allocVector3();
			localInertia.setValue( 0, 0, 0 );

			if( weight !== 0 ) {

				shape.calculateLocalInertia( weight, localInertia );

			}

			var threePosition = allocThreeVector3();
			var threeQuaternion = allocThreeQuaternion();

			object.getWorldPosition( threePosition );
			object.getWorldQuaternion( threeQuaternion );

			var position = allocVector3();
			var quaternion = allocQuaternion();

			position.setValue(
				threePosition.x,
				threePosition.y,
				threePosition.z
			);

			quaternion.setValue(
				threeQuaternion.x,
				threeQuaternion.y,
				threeQuaternion.z,
				threeQuaternion.w
			);

			var form = allocTransform();
			form.setIdentity();
			form.setRotation( quaternion );
			form.setOrigin( position );

			var state = new Ammo.btDefaultMotionState( form );

			var info = new Ammo.btRigidBodyConstructionInfo( weight, state, shape, localInertia );
			info.set_m_friction( friction );
			info.set_m_restitution( restitution );

			var body = new Ammo.btRigidBody( info );

			if ( type === 'static' ) {

				body.setCollisionFlags( body.getCollisionFlags() | 2 );
				//body.setActivationState( 4 );

			}

			if ( params.positionDamping !== undefined &&
			     params.rotationDamping !== undefined )
				body.setDamping( params.positionDamping, params.rotationDamping );

			body.setSleepingThresholds( 0, 0 );

			this.world.addRigidBody( body, 1 << groupIndex, groupTarget );

			body.type = type;

			freeVector3( localInertia );
			freeTransform( form );
			freeVector3( position );
			freeQuaternion( quaternion );
			freeThreeVector3( threePosition );
			freeThreeQuaternion( threeQuaternion );

			return body;

		},

		removeElementFromArray: function ( array, object ) {

			var readIndex = 0;
			var writeIndex = 0;

			for ( var i = 0, il = array.length; i < il; i ++ ) {

				if ( array[ readIndex ] !== object ) {

					array[ writeIndex ] = array[ readIndex ];
					writeIndex ++;

				}

				readIndex ++;

			}

			array.length = writeIndex;

		},

		stepSimulation: function ( delta ) {

			var unitStep = this.unitStep;
			var stepTime = delta;
			var maxStepNum = ( ( delta / unitStep ) | 0 ) + 1;

			if ( stepTime < unitStep ) {

				stepTime = unitStep;
				maxStepNum = 1;

			}

			if ( maxStepNum > this.maxStepNum ) {

				maxStepNum = this.maxStepNum;

			}

			this.world.stepSimulation( stepTime, maxStepNum, unitStep );

		},

		transferFromObjects: function () {

			for ( var i = 0, il = this.objects.length; i < il; i ++ ) {

				var object = this.objects[ i ];
				var body = this.bodyTable[ object.uuid ];

				if ( body.type === 'dynamic' ) continue;

				var form = allocTransform();
				form.setIdentity();

				var quaternion = allocQuaternion();

				var threePosition = allocThreeVector3();
				var threeQuaternion = allocThreeQuaternion();

				object.getWorldPosition( threePosition );
				object.getWorldQuaternion( threeQuaternion );

				form.getOrigin().setValue( 
					threePosition.x,
					threePosition.y,
					threePosition.z
				);

				quaternion.setValue(
					threeQuaternion.x,
					threeQuaternion.y,
					threeQuaternion.z,
					threeQuaternion.w
				);

				form.setRotation( quaternion );

				body.setCenterOfMassTransform( form );
				body.getMotionState().setWorldTransform( form );

				freeTransform( form );
				freeQuaternion( quaternion );
				freeThreeVector3( threePosition );
				freeThreeQuaternion( threeQuaternion );

			}

		},

		transferToObjects: function () {

			for ( var i = 0, il = this.objects.length; i < il; i ++ ) {

				var object = this.objects[ i ];
				var body = this.bodyTable[ object.uuid ];

				if ( body.type === 'static' ) continue;

				var form = allocTransform();
				var quaternion = allocQuaternion();

				body.getMotionState().getWorldTransform( form );

				var origin = form.getOrigin();
				form.getBasis().getRotation( quaternion );

				var threePosition = allocThreeVector3();
				var threeQuaternion = allocThreeQuaternion();

				threePosition.set(
					origin.x(),
					origin.y(),
					origin.z()
				);

				threeQuaternion.set(
					quaternion.x(),
					quaternion.y(),
					quaternion.z(),
					quaternion.w()
				);

				if ( object.parent !== null ) {

					// TODO: transform position and quaternion to object local world.

				}

				object.position.copy( threePosition );
				object.quaternion.copy( threeQuaternion );

				freeTransform( form );
				freeQuaternion( quaternion );

			}

		},

		// public

		add: function ( object, params ) {

			if ( params === undefined ) params = {};

			this.objects.push( object );

			var body = this.createRigidBody( object, params );

			this.bodies.push( body );
			this.bodyTable[ object.uuid ] = body;

		},

		remove: function ( object ) {

			var body = this.bodyTable[ object.uuid ];

			delete this.bodyTable[ object.uuid ];

			this.removeElementFromArray( this.objects, object );
			this.removeElementFromArray( this.bodies, body );

		},

		simulate: function ( delta ) {

			this.transferFromObjects();
			this.stepSimulation( delta );
			this.transferToObjects();

		}

	} );

	var vector3s = [];
	var quaternions = [];
	var transforms = [];

	var threeVector3s = [];
	var threeQuaternions = [];
	var threeMatrix4s = [];

	function allocVector3() {

		return vector3s.length > 0 ? vector3s.pop() : new Ammo.btVector3();

	}

	function freeVector3( v ) {

		vector3s.push( v );

	}

	function allocQuaternion() {

		return quaternions.length > 0 ? quaternions.pop() : new Ammo.btQuaternion();

	}

	function freeQuaternion( q ) {

		quaternions.push( q );

	}

	function allocTransform() {

		return transforms.length > 0 ? transforms.pop() : new Ammo.btTransform();

	}

	function freeTransform( t ) {

		transforms.push( t );

	}

	function allocThreeVector3() {

		return threeVector3s.length > 0 ? threeVector3s.pop() : new THREE.Vector3();

	}

	function freeThreeVector3( v ) {

		threeVector3s.push( v );

	}

	function allocThreeQuaternion() {

		return threeQuaternions.length > 0 ? threeQuaternions.pop() : new THREE.Quaternion();

	}

	function freeThreeQuaternion( q ) {

		threeQuaternions.push( q );

	}

	function allocThreeMatrix4() {

		return threeMatrix4s.length > 0 ? threeMatrix4s.pop() : new THREE.Matrix4();

	}

	function freeThreeMatrix4( m ) {

		threeMatrix4s.push( m );

	}

} )();
