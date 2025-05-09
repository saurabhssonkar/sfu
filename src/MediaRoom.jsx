// MediaRoom.js
import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
// import socket from './utils/socket';
const MediaRoom = () => {
  const localVideoRef = useRef(null);
  const videoContainerRef = useRef(null);

  const roomName = window.location.pathname.split('/')[2];
  console.log("roomName",roomName)

  const socketRef = useRef(null);
  const deviceRef = useRef(null);


  const [socket, setSocket] = useState(null);
  const [device, setDevice] = useState(null);
  const [rtpCapabilities, setRtpCapabilities] = useState(null);
  const [producerTransport, setProducerTransport] = useState(null);
  const [consumerTransports, setConsumerTransports] = useState([]);
  const [consumingTransports, setConsumingTransports] = useState([]);
  const [audioProducer, setAudioProducer] = useState(null);
  const [videoProducer, setVideoProducer] = useState(null);


  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState(null);

  const audioParamsRef = useRef({});
  const videoParamsRef = useRef({
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 }
  });
  

  useEffect(() => {
    const socket = io('https://localhost:3000/mediasoup', {
      transports: ['websocket'],
      secure: true,
      rejectUnauthorized: false,
    });
    socketRef.current = socket;

      
    console.log("sock",socket)
    setSocket(socket);
   
    socket.on('connection-success', ({ socketId }) => {
      console.log('Connected:', socketId);
      getLocalStream(socket);
    });

    socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId));
    socket.on('producer-closed', ({ remoteProducerId }) => closeConsumer(remoteProducerId));
  }, []);

  const getLocalStream = (socket) => {
    navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { min: 640, max: 1920 },
        height: { min: 400, max: 1080 }
      }
    }).then(stream => {
      localVideoRef.current.srcObject = stream;

      audioParamsRef.current = { track: stream.getAudioTracks()[0] };
      videoParamsRef.current = {
        ...videoParamsRef.current,
        track: stream.getVideoTracks()[0]
      };

      joinRoom(socket);
    }).catch(err => console.error(err));
  };

  const joinRoom = (socket) => {
    socket.emit('joinRoom', { roomName }, (data) => {
      setRtpCapabilities(data.rtpCapabilities);
      createDevice(data.rtpCapabilities,socket);
    });
  };

  const createDevice = async (routerRtpCapabilities,socket) => {
    try {
      const newDevice = new mediasoupClient.Device();
      await newDevice.load({ routerRtpCapabilities });
      deviceRef.current = newDevice
      setDevice(newDevice);
      console.log('Device RTP Capabilities', newDevice.rtpCapabilities);
      createSendTransport(newDevice,socket);
    } catch (error) {
      console.error(error);
    }
  };

  const createSendTransport = (device,socket) => {
    console.log("saurabh",device)
    socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      const transport = device.createSendTransport(params);
      setProducerTransport(transport);

      transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await socket.emit('transport-connect', { dtlsParameters });
          callback();
        } catch (err) {
          errback(err);
        }
      });

      transport.on('produce', async (parameters, callback, errback) => {
        try {
          socket.emit('transport-produce', {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          }, ({ id, producersExist }) => {
            callback({ id });
            if (producersExist) getProducers(socket);
          });
        } catch (err) {
          errback(err);
        }
      });

      connectSendTransport(transport);
    });
  };

  const connectSendTransport = async (transport) => {
    const audioProd = await transport.produce(audioParamsRef.current);
    const videoProd = await transport.produce(videoParamsRef.current);
    setAudioProducer(audioProd);
    setVideoProducer(videoProd);
  };

  const getProducers = (socket) => {
    socket.emit('getProducers', (producerIds) => {
      producerIds.forEach(signalNewConsumerTransport);
      // producerIds.forEach((producerId) => signalNewConsumerTransport(producerId, socket));

    });
  };

  const signalNewConsumerTransport = async (remoteProducerId) => {
    console.log(remoteProducerId,"remoteProducerId",socket,"socket")
    if (consumingTransports.includes(remoteProducerId)) return;
    setConsumingTransports(prev => [...prev, remoteProducerId]);

    socketRef.current.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
     // console.log("params",deviceRef.current)
      const consumerTransport = deviceRef.current.createRecvTransport(params);

      consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await  socketRef.current.emit('transport-recv-connect', {
            dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          callback();
        } catch (err) {
          errback(err);
        }
      });

      connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  };

  const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
    socketRef.current.emit('consume', {
      rtpCapabilities: deviceRef.current.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    }, async ({ params }) => {
      if (params.error) return;

      const consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      
      

      setConsumerTransports(prev => [
        ...prev,
        {
          consumerTransport,
          serverConsumerTransportId: params.id,
          producerId: remoteProducerId,
          consumer,
        }
      ]);
    

      const newElem = document.createElement('div');
      newElem.id = `td-${remoteProducerId}`;
      newElem.className = params.kind === 'video' ? 'remoteVideo' : '';
      newElem.innerHTML = `<${params.kind} id="${remoteProducerId}" autoplay class="video" />`;

      videoContainerRef.current.appendChild(newElem);
      // console.log("newElem",newElem)


      document.getElementById(remoteProducerId).srcObject = new MediaStream([consumer.track]);

      socketRef.current.emit('consumer-resume', { serverConsumerId: params.serverConsumerId });
    });
  };

  const closeConsumer = (remoteProducerId) => {
    console.log("producer are closed",consumerTransports)
    const transportData = consumerTransports.find(data => data.producerId === remoteProducerId);
    if (transportData) {
      transportData.consumerTransport.close();
      transportData.consumer.close();

      setConsumerTransports(prev =>
        prev.filter(data => data.producerId !== remoteProducerId)
      );

      const videoElem = document.getElementById(`td-${remoteProducerId}`);
      if (videoElem) videoElem.remove();
    }
  };

  return (
    <div >
      <h2>Room: {roomName}</h2>
      <video ref={localVideoRef} autoPlay muted className="video" />
      <h1 style={{color:"white"}}>---------------</h1>
      <div ref={videoContainerRef}></div>
    </div>
  );
};

export default MediaRoom;
