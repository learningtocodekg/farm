import Overlay from './Overlay';
import WeedMarkers from './WeedMarkers';
import ReviewPage from './ReviewPage';

export default function App() {
  if (window.location.pathname === '/review') {
    return <ReviewPage />;
  }
  return (
    <>
      <Overlay />
      <WeedMarkers />
    </>
  );
}
