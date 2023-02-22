window.addEventListener("load", (event) => {
  console.log("page is fully loaded");

  var codeBlocks = document.querySelectorAll('pre.highlight');

    codeBlocks.forEach(function (codeBlock) {
    // set the button visible on focus and hover
    var copyButton = document.createElement('button');
    //copyButton.className = 'copy';
    copyButton.type = 'button';
    copyButton.ariaLabel = 'Copy code to clipboard';
    copyButton.innerText = 'Copy';
    console.log ("Button created");
    
    copyButton.style.color = 'white';
    copyButton.style.backgroundColor = 'gray';
        
    copyButton.style.position = 'absolute';
    copyButton.style.right = '1.2rem';
    copyButton.style.top = '1.2rem';
    copyButton.style.opacity = 1;
    copyButton.textContent = 'Copy';

    codeBlock.addEventListener('mouseover', function () {
        console.log("codeblock mouseover");
        copyButton.style.background = 'rgba(0, 0, 0, 0.7)';
        copyButton.style.backgroundColor = 'gray';
        copyButton.style.opacity = 1;
    });

    // on mouseout hide the button
    codeBlock.addEventListener('mouseout', function () {
        console.log("block mouseout");
        copyButton.style.opacity = 0;
    });
    
    //change the style on mouseover
    copyButton.addEventListener('mouseover',function() {
        console.log("btn mouseover");
        copyButton.style.background = 'rgba(0, 0, 0, 0.7)';
        copyButton.style.backgroundColor = 'gray';
        copyButton.style.opacity = 1;
    });

    codeBlock.append(copyButton);

    copyButton.addEventListener('click', function () {
        var code = codeBlock.querySelector('code').innerText.trim();
        window.navigator.clipboard.writeText(code);

        copyButton.innerText = 'Copied';
        var fourSeconds = 4000;

        setTimeout(function () {
        copyButton.innerText = 'Copy';
        }, fourSeconds);
    });
    });
});

