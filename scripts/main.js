'use strict';

Raven.config('https://967b002cd9b849f795b5d1d7dcc50c7e@sentry.io/243389', {
    environment: CHAPBOOK_CONFIG.env,
    shouldSendCallback: function shouldSendCallback() {
        return CHAPBOOK_CONFIG.env === 'production';
    },
    debug: CHAPBOOK_CONFIG.env === 'development'
}).install();

Raven.context(function () {
    'use strict';

    var TEX_FLAGS = '-halt-on-error -interaction nonstopmode --shell-escape ';

    var IS_CHROME = typeof navigator !== 'undefined' && navigator.userAgent.match(/Chrome/) && !navigator.userAgent.match(/Edge/);

    var IS_FIREFOX = typeof navigator !== 'undefined' && navigator.userAgent.match(/Firefox/);

    var f = 'chapbook';
    var startButton = document.getElementById('create-upload-button');
    var exampleButton = document.getElementById('use-example-button');
    var startOverButton = document.getElementById('start-over-button');
    var uploadInput = document.getElementById('pdf-upload');
    var uploadInputName = document.getElementById('pdf-upload-name');
    var loading = document.getElementById('loading');
    var pdfParent = document.getElementById('pdf-parent');
    var pdfDownload = document.getElementById('pdf-download');
    var pdfSuccess = document.getElementById('pdf-success');
    var pdfError = document.getElementById('pdf-error');
    var perfOut = document.getElementById('perf-out');
    var kernel = null;
    var useExample = false;
    var filesLoaded = false;
    var activeStep = 1;

    if (window.location.search.indexOf('test=1') >= 0) {
        $(exampleButton).show();
    }

    function setActiveStep(newActiveStep) {
        activeStep = newActiveStep;

        $('.chapbook-step').each(function () {
            var $this = $(this);
            var stepNum = $this.data('num');
            var $content = $this.find('.chapbook-step-content');
            var $success = $this.find('.chapbook-step-success');

            $this.removeClass('text-disabled text-muted');
            $content.hide();
            $success.hide();

            if (activeStep === stepNum) {
                $content.show();
            } else if (activeStep < stepNum) {
                $this.addClass('text-muted');
            } else {
                $this.addClass('text-disabled');
                $success.show();
            }
        });
    }

    function replaceAll(target, search, replacement) {
        return target.replace(new RegExp(search, 'g'), replacement);
    }

    function startBrowsix() {
        if (!IS_CHROME || typeof SharedArrayBuffer === 'undefined') {
            $('#sab-alert').removeClass('browsix-hidden');
            // return;
        }

        $('#loading').removeClass('browsix-hidden');

        window.Boot('XmlHttpRequest', ['index.json', 'fs', true], function (err, k) {
            if (err) {
                console.log(err);
                throw new Error(err);
            }
            kernel = k;
            filesLoadedCallback();
        });
    }

    function enableStartButtonIfNecessary() {
        if (filesLoaded && (useExample || uploadInput.value)) {
            startButton.disabled = false;
        }
    }

    function filesLoadedCallback() {
        $('#loading').addClass('browsix-hidden');

        filesLoaded = true;
        enableStartButtonIfNecessary();
    }

    function renderProgress(progress) {
        console.log('progress', progress);
        $('#build-bar')
        // Start bar at 5%
        .css('width', '' + Math.min(progress * 95 / 100 + 5, 100) + '%').attr('aria-valuenow', progress).html('' + progress + '%');
    }

    function showPDF() {
        var fName = f + '.pdf';
        var buf = new Uint8Array(kernel.fs.readFileSync(fName).data.buff.buffer);
        var blob = new Blob([buf], { type: 'application/pdf' });
        var url = window.URL.createObjectURL(blob);

        var pdfEmbed = document.createElement('embed');
        pdfEmbed.className = 'pdf';
        pdfEmbed['src'] = url;
        pdfEmbed.setAttribute('alt', f + '.pdf');
        pdfEmbed.setAttribute('pluginspage', 'http://www.adobe.com/products/acrobat/readstep2.html');

        console.log(url);

        $(pdfDownload).attr('href', url).off('click').click(function (e) {
            e.preventDefault();
            download(blob, 'chapbook.pdf');
        });

        pdfParent.innerHTML = '';
        pdfParent.appendChild(pdfEmbed);

        $(startButton).removeClass('is-active').blur();
    }
    var sequence = [
    // 'pdflatex ' + TEX_FLAGS + '-draftmode ' + f,
    // 'bibtex ' + f,
    //		'pdflatex ' + TEX_FLAGS + '-draftmode ' + f,
    'pdflatex ' + TEX_FLAGS + f + '.tex'];
    function runLatex() {
        var startTime = performance.now();

        var progress = 10;

        $('#timing').addClass('browsix-hidden');
        perfOut.innerHTML = '';
        pdfParent.innerHTML = '<center><b>PDF will appear here when built</b></center>';

        var log = '';
        var seq = sequence.slice();
        function onStdout(pid, out) {
            log += out;
            //console.log(out);
        }
        function onStderr(pid, out) {
            log += out;
            //console.log(out);
        }
        function runNext(pid, code) {
            if (code !== 0) {
                Raven.captureException(new Error('Chapbook creation failed'), {
                    extra: {
                        log: log
                    }
                });

                $(pdfError).show();
                $(pdfSuccess).hide();

                setActiveStep(3);
                $(startButton).removeClass('is-active').blur();

                return;
            }

            renderProgress(progress);
            progress += 25;

            //console.log(log);
            log = '';
            var cmd = seq.shift();
            console.log(cmd);
            if (!cmd) {
                showPDF();

                progress = 100;
                renderProgress(progress);

                var totalTime = '' + (performance.now() - startTime) / 1000;
                var dot = totalTime.indexOf('.');
                if (dot + 2 < totalTime.length) {
                    totalTime = totalTime.substr(0, dot + 2);
                }
                $('#timing').removeClass('browsix-hidden');
                perfOut.innerHTML = totalTime;

                setActiveStep(3);

                return;
            }

            // These packages are in fs/usr/share/texmf-dist/tex/latex/
            // Outputted path is relative to fs/
            var latexPackagePaths = ['pdfpages', 'koma-script', 'graphics', 'base', 'tools', 'eso-pic', 'graphics-cfg', 'pdftex-def', 'oberdiek'].map(function (name) {
                return 'usr/share/texmf-dist/tex/latex/' + name;
            });

            // These packages are in fs/usr/share/texmf-dist/tex/generic/
            // Outputted path is relative to fs/
            var genericPackagePaths = ['oberdiek', 'ifxetex'].map(function (name) {
                return 'usr/share/texmf-dist/tex/generic/' + name;
            });

            var texPaths = ['.'].concat(latexPackagePaths).concat(genericPackagePaths);

            kernel.system(cmd, runNext, onStdout, onStderr, ['TEXINPUTS=' + texPaths.join(':')]);
        }
        runNext(-1, 0);
    }
    function clicked(next) {
        $(startButton).toggleClass('is-active').blur();
        next();
    }
    function exampleClicked() {
        kernel.fs.writeFile('document.pdf', kernel.fs.readFileSync('example.pdf', 'binary'), 'binary', function () {
            runLatex();
        });
    }
    function startClicked() {
        setActiveStep(2);

        if (useExample) {
            exampleClicked();
            return;
        }

        var file = uploadInput.files[0];
        if (!file || file.type !== 'application/pdf') {
            alert('Must upload a .pdf file');
            $(startButton).removeClass('is-active').blur();
            return;
        }

        var reader = new FileReader();
        reader.onload = function (event) {
            var result = event.target.result;
            kernel.fs.writeFile('document.pdf', result, 'binary', function () {
                runLatex();
            });
        };
        reader.readAsBinaryString(file);
    }
    startButton.addEventListener('click', function () {
        clicked(startClicked);
    });

    uploadInput.addEventListener('change', function () {
        useExample = false;

        enableStartButtonIfNecessary();
    });

    exampleButton.addEventListener('click', function () {
        useExample = true;
        $(uploadInputName).html('example.pdf');

        enableStartButtonIfNecessary();
    });

    startOverButton.addEventListener('click', function () {
        $(uploadInput).val('');
        $(uploadInputName).text('');
        startButton.disabled = true;
        renderProgress(0);
        setActiveStep(1);
    });

    startBrowsix();
});
//# sourceMappingURL=main.js.map
