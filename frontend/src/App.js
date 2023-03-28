import heart from './HUMAN_HEART-cropped.svg';
import { TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from 'react-query';
import Selector from './components/Reactions/Selector';
import ReactionCounts from './components/Reactions/ReactionCounts';

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
  const [currReaction, setCurrReaction] = useState('NoReaction');
  const [currUuid, setCurrUuid] = useState(null);
  const [currReactionCounts, setCurrReactionCounts] = useState(null);

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


  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReactionCounts(todaysMetadataResponse.data.counts);
    }
  }, [todaysMetadataResponse]);

  // On emoji press, update the reaction
  const onEmojiClick = (uuid) => (reaction) => {
    axios.put(TODAYS_METADATA_ENDPOINT, {'reaction': reaction, 'uuid': uuid})
    .then(res => {
      // Means the put was successful
      setCurrReaction(reaction)
      setCurrReactionCounts(res.data.counts)
    })
  }

  return (
    <div className="App">
      <div className="Title-Header"> 
        <p>
          ForMaeov
        </p>
        <img src={heart} className="Header-Image" alt="Human heart" />
      </div>
      <AppBody 
            todaysImageLoading={todaysImageResponse.isLoading}
            todaysMetadataLoading={todaysMetadataResponse.isLoading}
            imageString={todaysImageResponse.data} 
            currReaction={currReaction}
            currReactionCounts={currReactionCounts}
            currUuid={currUuid}
            onEmojiClick={onEmojiClick} />
    </div>
  );
}

const AppBody = ({todaysImageLoading, todaysMetadataLoading, imageString, currReaction, currReactionCounts, currUuid, onEmojiClick}) => (
  <div className="App-Body">
      {
        todaysImageLoading || todaysMetadataLoading
          ? <Loading /> 
          : <Successful 
              imageString={imageString}
              currUuid={currUuid}
              currReaction={currReaction}
              currReactionCounts={currReactionCounts}
              onEmojiClick={onEmojiClick(currUuid)} />
      }
  </div>
);

const Successful = ({imageString, currReaction, currReactionCounts, onEmojiClick}) => {
  return <div>
    <img src={`data:image/jpg;base64,${imageString}`} className="Todays-Image" alt="todays pic" />
    <ReactionCounts currReactionCounts={currReactionCounts} />
    <Selector currReaction={currReaction} onSelect={onEmojiClick} />
  </div>
}

const Loading = ({props}) => {
  return <div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
}