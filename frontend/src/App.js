import heart from './HUMAN_HEART.svg';
import { TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from 'react-query';
import Selector from './components/Selector/Selector';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient} >
      <Page />
    </QueryClientProvider>
  )
}

function Page() {
  // Fetch the current image
  const todaysImageResponse = useQuery({
    queryKey: ['imageString'],
    queryFn: () => 
      axios.get(TODAYS_IMAGE_ENDPOINT)
        .then((res) => res.data)
  });

  // Fetch todays metadata
  const todaysMetadataResponse = useQuery({
    queryKey: ['metadata'],
    retry: false,
    queryFn: () =>  
      axios.get(TODAYS_METADATA_ENDPOINT, { 
        params : { 
          uuid: localStorage.getItem('uuid') 
        } 
      }).then((res) => res.data)
  });

  return <SubPage 
          todaysImageResponse={todaysImageResponse}
          todaysMetadataResponse={todaysMetadataResponse} />
}

const SubPage = ({ todaysImageResponse, todaysMetadataResponse }) => {
  const [showImage, setShowImage] = useState(false);
  const [currReaction, setCurrReaction] = useState('NoReaction');
  const [currUuid, setCurrUuid] = useState(null);

  // Set state and localStorage based on todays metadata
  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReaction(todaysMetadataResponse.data.reaction);
    
      const currUuid = localStorage.getItem('uuid')

      if (currUuid === null) {
        localStorage.setItem('uuid', todaysMetadataResponse.data.uuid);
        setCurrUuid(todaysMetadataResponse.data.uuid);
      } else {
        setCurrUuid(currUuid);
      }
    }
  }, [todaysMetadataResponse])

  // Start showing the image
  const onClick = () => setShowImage(true);

  // On emoji press, update the reaction
  const onEmojiClick = (uuid) => (reaction) => {
    axios.put(TODAYS_METADATA_ENDPOINT, {'reaction': reaction, 'uuid': uuid})
    .then(res => {
      // Means the put was successful
      setCurrReaction(reaction)
    })
  }

  return (
    <div className="App">
      <div className="Title-Header" onClick={onClick}> 
        <img src={heart} className="Header-Image" alt="Human heart" />
        <p>
          Click only if you're Maeov. No one else click 😡
        </p>
      </div>
      { showImage 
        ? <AppBody 
            todaysImageLoading={todaysImageResponse.isLoading}
            todaysMetadataLoading={todaysMetadataResponse.isLoading}
            imageString={todaysImageResponse.data} 
            currReaction={currReaction}
            currUuid={currUuid}
            onEmojiClick={onEmojiClick} /> 
        : null }
    </div>
  );
}

const AppBody = ({todaysImageLoading, todaysMetadataLoading, imageString, currReaction, currUuid, onEmojiClick}) => (
  <div className="App-Body">
      {
        todaysImageLoading || todaysMetadataLoading
          ? <Loading /> 
          : <Successful 
              imageString={imageString}
              currUuid={currUuid}
              currReaction={currReaction}
              onEmojiClick={onEmojiClick(currUuid)} />
      }
  </div>
);

const Successful = ({imageString, currReaction, onEmojiClick}) => {
  return <div>
    <img src={`data:image/jpg;base64,${imageString}`} className="Todays-Image" alt="todays pic" />
    <Selector currReaction={currReaction} onSelect={onEmojiClick} />
    <p className="Todays-Text">
      Here is todays specially selected image 😎
      I hope you like this one and I hope you come back tomorrow for another one. 
    </p>
  </div>
}

const Loading = ({props}) => {
  return <div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
}