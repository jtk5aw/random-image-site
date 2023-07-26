import { DailyImage } from '../DailyImage/Image';
import _ from 'lodash';

export const Swiper = ({weeklyRecap, currFavoriteUrl, onRecapClick}) => {
  return <div> 
    <swiper-container className='h-10'>
    <StartingSlot currFavoriteUrl={currFavoriteUrl} />
      { 
        _.map(weeklyRecap, (url, index) => {
          return <SwiperSlide url={url} index={index} onRecapClick={onRecapClick} />
        })
      }
    </swiper-container>
  </div>
}

const StartingSlot = ({currFavoriteUrl}) => {
  return <div slot="container-start" className='flex flex-row justify-center'>
    {
    currFavoriteUrl === '' 
    ? null 
    : <DailyImage 
        url={currFavoriteUrl} 
        className={'object-scale-down max-w-sm max-h-24 p-2'}
        alt='Currently selected favorite image'/>
    }
  </div>
}

const SwiperSlide = ({url, index, onRecapClick}) => {
  return <swiper-slide key={url}> 
    <DailyImage 
      url={url} 
      alt={`This is the ${index} in the carousel. Will add better alt text later`} 
      onClick={onRecapClick} />
  </swiper-slide>
}

export default Swiper;