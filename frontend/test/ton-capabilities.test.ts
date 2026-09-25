import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tonCapabilities} from '../src/ton-capabilities.ts';
test('wallet advertised features, not wallet name or W5 alone, enable gasless',()=>{
 const telegram={device:{appName:'telegram-wallet',features:[{name:'SendTransaction',maxMessages:4}]}};
 assert.equal(tonCapabilities(telegram,'W5',true).gaslessCandidate,false);
 assert.equal(tonCapabilities({device:{features:[{name:'SignMessage'}]}},'W5',true).gaslessCandidate,true);
 assert.equal(tonCapabilities({device:{features:[{name:'SignMessage'}]}},'V4R2',true).gaslessCandidate,false);
 assert.equal(tonCapabilities({device:{features:[{name:'SignMessage'}]}},'W5',false).gaslessCandidate,false);
 assert.equal(tonCapabilities({device:{features:[{name:'SendTransaction',itemTypes:['jetton']}] }},'W5',true).supportsStructuredJetton,true);
});
